// Targeted real-conversion shutdown. Host observer runs outside UID10001/cgroup.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
assert.equal(process.platform, 'linux');
assert.equal(process.getuid(), 0, 'Root is only the disposable CI host observer');
const sourceCommit=process.argv[2];assert.match(sourceCommit,/^[a-f0-9]{40}$/);
const startedAt=new Date().toISOString(), name='si-heif-active-shutdown';
const base='http://127.0.0.1:18080', secret='synthetic-ci-fixture-key-not-an-application-secret';
const jobRoot=fs.mkdtempSync(path.join(process.cwd(),'.heif-shutdown-job-'));
fs.chownSync(jobRoot,10001,10001);fs.chmodSync(jobRoot,0o700);
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:15000,maxBuffer:1024*1024}).trim();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const emit=value=>console.log(JSON.stringify(value));
function events(file){
  const result=Object.fromEntries(fs.readFileSync(file,'utf8').trim().split('\n').map(row=>{const [k,v]=row.split(' ');return[k,Number(v)];}));
  assert.ok(Number.isInteger(result.oom)&&Number.isInteger(result.oom_kill));return result;
}
function proc(pid){
  try{const raw=fs.readFileSync(`/proc/${pid}/stat`,'utf8');const f=raw.slice(raw.lastIndexOf(')')+2).split(' ');
    return{pid,state:f[0],parent:Number(f[1]),group:Number(f[2]),start:f[19]};
  }catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')return null;throw e;}
}
function headers(body){
  const timestamp=String(Math.floor(Date.now()/1000)),id=randomUUID(),digest=createHash('sha256').update(body).digest('hex');
  return{'content-type':'application/octet-stream','x-si-timestamp':timestamp,'x-si-request-id':id,'x-si-body-sha256':digest,
    'x-si-signature':'v1='+createHmac('sha256',secret).update(`v1\n${timestamp}\n${id}\n${digest}`).digest('hex')};
}
async function request(body,timeout=15000){
  const start=performance.now();
  try{const r=await fetch(base+'/v1/convert',{method:'POST',body,headers:headers(body),signal:AbortSignal.timeout(timeout)});await r.arrayBuffer();return{status:r.status,elapsedMs:Math.round(performance.now()-start)};}
  catch(e){return{error:e.name,elapsedMs:Math.round(performance.now()-start)};}
}
let created=false;
try{
  docker('run','-d','--name',name,'--cap-drop','ALL','--security-opt','no-new-privileges','--memory','512m','--memory-swap','512m','--cpus','0.1','--pids-limit','512',
    '-p','127.0.0.1:18080:8080','--mount',`type=bind,source=${jobRoot},target=/tmp/heif-converter`,'-e',`HEIF_CONVERTER_HMAC_SECRET=${secret}`,'si-heif-confined');created=true;
  const initial=JSON.parse(docker('inspect',name))[0];
  assert.deepEqual(initial.Config.Cmd,['/usr/local/bin/si-heif-confine','--supervise']);assert.equal(initial.Config.User,'10001:10001');
  assert.equal(initial.HostConfig.Memory,536870912);assert.equal(initial.HostConfig.MemorySwap,536870912);
  assert.equal(initial.HostConfig.NanoCpus,100000000);assert.equal(initial.HostConfig.PidsLimit,512);
  const supervisorPid=initial.State.Pid,cgroup=fs.readFileSync(`/proc/${supervisorPid}/cgroup`,'utf8').trim().match(/^0::(.+)$/m)?.[1];
  assert.ok(cgroup&&cgroup.startsWith('/')&&!cgroup.includes('..'));
  const groupPath=path.join('/sys/fs/cgroup',cgroup),parentEventsPath=path.join(path.dirname(groupPath),'memory.events');
  // memory.events is hierarchical unless the mount selects local events.
  // Persistent ancestor permits a final read after Docker removes the leaf.
  assert.doesNotMatch(fs.readFileSync('/proc/self/mountinfo','utf8'),/memory_localevents/);
  const parentBefore=events(parentEventsPath),leafBefore=events(path.join(groupPath,'memory.events'));
  assert.equal(leafBefore.oom,0);assert.equal(leafBefore.oom_kill,0);
  let health;
  for(let i=0;i<60;i++){
    try{const r=await fetch(base+'/health/ready',{signal:AbortSignal.timeout(1500)});if(r.ok){health=await r.json();break;}}catch{}
    await pause(500);
  }
  assert.equal(health?.protocolVersion,2);assert.equal(health.capabilities.supervisor,'subreaper-v1');
  const camera=Buffer.from(fs.readFileSync('tests/media-native/fixtures/camera-sample.base64','utf8'),'base64');
  const pending=request(camera);
  let rows,native;
  for(let i=0;i<120;i++){
    rows=docker('top',name,'-eo','pid,ppid,pgid,stat,args').split('\n').slice(1).map(line=>{
      const f=line.trim().split(/\s+/);return{pid:Number(f[0]),parent:Number(f[1]),group:Number(f[2]),state:f[3],command:f.slice(4).join(' ')};
    });
    native=rows.find(row=>/\/usr\/local\/bin\/heif-convert(?: |$)/.test(row.command)&&!row.state.startsWith('Z'));
    if(native)break;await pause(25);
  }
  assert.ok(native,'Must observe the real decoder running before signaling');
  const members=rows.filter(row=>row.group===native.group).map(row=>proc(row.pid));
  assert.ok(members.length>=2&&members.every(m=>m&&m.state!=='Z'));assert.ok(native.group!==supervisorPid);
  // The actual live native PID is stronger than a broker log, which can still
  // be buffered under CPU throttling. Do not turn that logging race into failure.
  const nativePhaseLogged=/CONFINEMENT_PHASE:NATIVE_STARTED/.test(docker('logs',name));
  const beforeSignal=proc(native.pid);
  assert.ok(beforeSignal&&beforeSignal.state!=='Z'&&beforeSignal.start===members.find(m=>m.pid===native.pid).start);
  const signalAt=new Date().toISOString(),signalStart=performance.now();
  emit({kind:'ACTIVE_BEFORE_SIGNAL',signalAt,members,nativePhaseLogged,leafEvents:events(path.join(groupPath,'memory.events'))});
  docker('kill','--signal','TERM',name);
  const afterSignalRequest=request(camera,5000),activeResult=await pending;
  assert.ok(activeResult.error||activeResult.status>=400,'Active conversion must not succeed after shutdown');
  assert.notEqual(activeResult.error,'TimeoutError','Server must terminate the request before client deadline');
  // Keep the host client's event loop running while Docker waits; blocking it
  // would prevent outstanding HTTP socket events from being serviced.
  const waited=await promisify(execFile)('docker',['wait',name],{encoding:'utf8',timeout:15000});
  const exit=Number(waited.stdout.trim()),shutdownMs=Math.round(performance.now()-signalStart);
  emit({kind:'ACTIVE_AFTER_EXIT',exit,shutdownMs,activeResult,postSignalRequest:await afterSignalRequest,
    jobEntries:fs.readdirSync(jobRoot),membersAfter:members.map(m=>proc(m.pid)),ancestorEvents:events(parentEventsPath)});
  assert.equal(exit,0);assert.ok(shutdownMs<10000,'Must exit before supervisor hard grace');
  const post=await afterSignalRequest;assert.ok(post.error||post.status>=400,'No successful admission after signal');
  const state=JSON.parse(docker('inspect',name))[0].State;assert.equal(state.Running,false);assert.equal(state.OOMKilled,false);
  assert.deepEqual(members.filter(m=>proc(m.pid)?.start===m.start),[],'Observed PIDs must be gone, including zombies');
  const groupSurvivors=fs.readdirSync('/proc').filter(entry=>/^\d+$/.test(entry)).map(Number).map(proc).filter(row=>row?.group===native.group);
  assert.deepEqual(groupSurvivors,[],'Whole process group must disappear');
  assert.deepEqual(fs.readdirSync(jobRoot),[],'Exact private job root empty before test cleanup');
  const parentAfter=events(parentEventsPath);assert.equal(parentAfter.oom,parentBefore.oom);assert.equal(parentAfter.oom_kill,parentBefore.oom_kill);
  emit({kind:'ACTIVE_SHUTDOWN',result:'PASSED',sourceCommit,startedAt,signalAt,endedAt:new Date().toISOString(),shutdownMs,image:initial.Image,
    fixture:{bytes:camera.length,sha256:createHash('sha256').update(camera).digest('hex')},actualNativeObserved:true,members,activeResult,postSignalRequest:post,
    exit,emptyJobRoot:true,wholeGroupGone:true,noObservedZombie:true,supervisorNormalExitRequiresECHILD:true,oomKilled:state.OOMKilled,leafBefore,
    ancestorEventsBefore:parentBefore,ancestorEventsAfter:parentAfter,
    reapingEvidence:'Observed PIDs/group absent plus default C supervisor normal exit whose source requires waitpid ECHILD; no per-child wait status instrumentation',productionRuntimeVerified:false});
}finally{
  if(created){try{console.log(docker('logs',name));}catch{}try{console.log(docker('inspect','--format','{{json .State}}',name));}catch{}try{docker('rm','-f',name);}catch{}}
  // Remove only this exact empty temporary directory; retain nonempty failed evidence.
  try{fs.rmdirSync(jobRoot);}catch(e){emit({kind:'JOB_ROOT_RETAINED',reason:e.code});}
}
