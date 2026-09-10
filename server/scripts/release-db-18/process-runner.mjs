import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { must } from './core.mjs';

export const PROCESS_CLEANUP_MS = 5000;
const TERM_GRACE_MS = 1500;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Linux /proc metadata only: no command lines, environments or unrelated process data are retained.
export function processGroupMembers(groupId) {
  must(process.platform === 'linux' && Number.isInteger(groupId) && groupId > 1 && groupId !== process.pid, 'PROCESS_GROUP_INVALID');
  const members = [];
  for (const name of readdirSync('/proc')) {
    if (!/^[0-9]+$/.test(name)) continue;
    let stat;
    try { stat = readFileSync(`/proc/${name}/stat`, 'utf8'); }
    catch (error) { if (['ENOENT','ESRCH','EACCES'].includes(error.code)) continue; throw error; }
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (Number(fields[2]) === groupId) members.push({ pid:Number(name), state:fields[0], startTicks:fields[19] });
  }
  return members.sort((a,b)=>a.pid-b.pid);
}
const liveMembers = group => processGroupMembers(group).filter(p=>!['Z','X'].includes(p.state));

// The real CLI leads its own Linux process group; its schema-engine child inherits that group.
// Killing only the Node CLI is insufficient. All output is drained by byte count and discarded.
export async function runPrismaProcess(command, args, options) {
  must(Number.isInteger(options.timeout) && options.timeout > 0, 'PROCESS_TIMEOUT_INVALID');
  const linux = process.platform === 'linux';
  const started = Date.now();
  let child, exitCode=null, exitSignal=null, exited=false, reason=null, spawnFailed=false;
  let stdoutBytes=0, stderrBytes=0, cleanupPromise;
  let timeoutTimer;
  const processCleanup={scope:linux?'LINUX_PROCESS_GROUP':'LOCAL_WINDOWS_DIRECT_CHILD',groupId:null,termSent:false,killSent:false,observedPids:[],remainingLivePids:[],remainingZombiePids:[],quiescent:null,verified:false,elapsedMs:0};
  const observed = new Set();
  const remember = members => { for (const p of members) observed.add(p.pid); };
  function signalGroup(signal) {
    if (!child?.pid) return;
    try {
      if (linux) process.kill(-child.pid, signal); else child.kill(signal);
      if(signal==='SIGTERM')processCleanup.termSent=true;
      if(signal==='SIGKILL')processCleanup.killSent=true;
    } catch(error) { if(error.code!=='ESRCH')processCleanup.signalFailed=true; }
  }
  async function cleanup(force) {
    if(cleanupPromise)return cleanupPromise;
    cleanupPromise=(async()=>{
      const begin=Date.now();
      if(!child?.pid){processCleanup.quiescent=true;processCleanup.verified=true;return;}
      if(!linux){if(force)signalGroup('SIGKILL');processCleanup.quiescent=exited;processCleanup.verified=false;return;}
      try {
        let members=processGroupMembers(child.pid);remember(members);
        // Give a normally exiting CLI a short chance to reap its children before classifying lingering work.
        if(!force && members.some(p=>!['Z','X'].includes(p.state))) {
          await delay(100);members=processGroupMembers(child.pid);remember(members);
        }
        if(force || members.some(p=>!['Z','X'].includes(p.state))) {
          if(!reason)reason='PROCESS_TREE_LINGERING';
          if(members.some(p=>!['Z','X'].includes(p.state)))signalGroup('SIGTERM');
          while(Date.now()-begin<TERM_GRACE_MS && liveMembers(child.pid).length)await delay(50);
          members=processGroupMembers(child.pid);remember(members);
          if(members.some(p=>!['Z','X'].includes(p.state)))signalGroup('SIGKILL');
          while(Date.now()-begin<PROCESS_CLEANUP_MS && liveMembers(child.pid).length)await delay(50);
        }
        members=processGroupMembers(child.pid);remember(members);
        processCleanup.remainingLivePids=members.filter(p=>!['Z','X'].includes(p.state)).map(p=>p.pid);
        processCleanup.remainingZombiePids=members.filter(p=>['Z','X'].includes(p.state)).map(p=>p.pid);
        processCleanup.quiescent=processCleanup.remainingLivePids.length===0;
        processCleanup.verified=true;
      } catch {processCleanup.quiescent=null;processCleanup.verified=false;processCleanup.inspectionFailed=true;}
      finally {processCleanup.observedPids=[...observed].sort((a,b)=>a-b).slice(0,128);processCleanup.elapsedMs=Date.now()-begin;}
    })();
    return cleanupPromise;
  }
  let finish;
  const completion = new Promise(resolve=>{finish=resolve;});
  let finishing=false;
  async function conclude(force) {
    if(finishing)return;finishing=true;
    clearTimeout(timeoutTimer);
    await cleanup(force);
    process.off('SIGTERM',onTerm);process.off('SIGINT',onInt);
    // Descriptors cannot keep the launcher alive after the bounded cleanup attempt.
    child?.stdout?.destroy();child?.stderr?.destroy();child?.unref();
    finish({status:exitCode,signal:exitSignal,error:spawnFailed?true:undefined,reason,timeoutMs:options.timeout,
      timedOut:reason==='TIMEOUT',interrupted:['PARENT_SIGTERM','PARENT_SIGINT'].includes(reason),
      stdoutBytes,stderrBytes,durationMs:Date.now()-started,processCleanup});
  }
  function stop(code) {if(!reason)reason=code;void conclude(true);}
  function onTerm(){stop('PARENT_SIGTERM');}
  function onInt(){stop('PARENT_SIGINT');}
  process.on('SIGTERM',onTerm);process.on('SIGINT',onInt);
  try {
    child=spawn(command,args,{cwd:options.cwd,env:options.env,detached:linux,windowsHide:true,stdio:['ignore','pipe','pipe']});
    processCleanup.groupId=linux?(child.pid??null):null;
    child.on('error',()=>{spawnFailed=true;stop('SPAWN_FAILED');});
    child.once('exit',(code,signal)=>{exitCode=code;exitSignal=signal;exited=true;void conclude(false);});
    child.stdout.on('data',chunk=>{stdoutBytes+=chunk.length;if(stdoutBytes+stderrBytes>(options.maxBuffer??1048576))stop('OUTPUT_LIMIT');});
    child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stdoutBytes+stderrBytes>(options.maxBuffer??1048576))stop('OUTPUT_LIMIT');});
    timeoutTimer=setTimeout(()=>stop('TIMEOUT'),options.timeout);
    options.onSpawn?.(child.pid);
  } catch {spawnFailed=true;stop('SPAWN_FAILED');}
  return completion;
}
