// Runs the real worker -> framed exit -> runner -> service -> fatal lifecycle
// chain on Windows. Only Linux launch/group/filesystem boundary operations and
// startup kernel evidence are adapted; this does not attest Linux containment.
import fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { processControlFixture } from '../processControlFixture.js';

const scenario=process.argv[2],fault=scenario.startsWith('fault-');
const outcome=!fault&&scenario.endsWith('exit78')?'exit78':fault?scenario.slice(6):scenario;
const cancellation=new AbortController();
const actual={...fs},spawn=childProcess.spawn,kill=process.kill;
const root=await actual.mkdtemp(path.join(os.tmpdir(),'si-worker-chain-'));
const children=new Map(),events=[],diagnostics=[];
let workerExit,workerFrame,runnerError,spawned=0,deadline,lifetimes=0,workerStderr='';
const map=name=>typeof name==='string'&&name.startsWith('/tmp/heif-converter')?root+name.slice('/tmp/heif-converter'.length):name;
for(const method of ['chmod','mkdtemp','open','readdir','rm','writeFile'])fs[method]=(name,...args)=>actual[method](map(name),...args);
fs.stat=async name=>{
  const result=await actual.stat(map(name));
  // Windows mode bits cannot attest Unix directory permissions.
  if(result.isDirectory())result.mode=(result.mode&~0o777)|0o700;
  return result;
};
childProcess.spawn=(command,args,options)=>{
  if(command!=='/usr/local/bin/si-heif-confine')throw Error('Unexpected test executable');
  spawned++;
  const job=args[1],module=fault?'confinedFaultProbe.js':'confinedWorker.js';
  const script=fileURLToPath(new URL(`../../src/${module}`,import.meta.url));
  const preload=fileURLToPath(new URL('./nativeFailurePreload.js',import.meta.url));
  const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,script,job+'/input.heic',job+'/decoded.png',...(fault?['orphan']:[])],{
    ...options,detached:false,cwd:job,
    env:{SystemRoot:process.env.SystemRoot??'',SI_TEST_HELPER_OUTCOME:outcome,
      SI_TEST_PAUSE_NATIVE_EXIT:scenario.includes('native-exit78')?'1':'0'},
  });
  if(child.pid)children.set(child.pid,{child,closed:false});
  const output=[];
  child.stdout.on('data',data=>output.push(data));
  child.stderr.on('data',data=>{workerStderr+=data.toString();});
  child.once('close',code=>{
    workerExit=code;
    if(child.pid)children.get(child.pid).closed=true;
    const buffer=Buffer.concat(output);
    if(buffer.length>=4)workerFrame=JSON.parse(buffer.subarray(4,4+buffer.readUInt32BE(0)).toString());
  });
  return child;
};
process.kill=(pid,signal)=>{
  if(pid>=0)return kill(pid,signal);
  const entry=children.get(-pid);
  if(!entry||entry.closed)throw Object.assign(Error('gone'),{code:'ESRCH'});
  if(signal!==0)entry.child.kill(signal);
  return true;
};
syncBuiltinESMExports();
try {
  const {runConfinedJob}=await import('../../src/confinedRunner.js');
  const {ConfinedHeifConverter}=await import('../../src/confinedService.js');
  const {createFatalLifecycle}=await import('../../src/bootstrap.js');
  const service=new ConfinedHeifConverter({
    bootstrap:async()=>({resources:{}}),processProof:async()=>processControlFixture,
    checkRoot:async()=>{},checkCounters:async()=>{},onDiagnostic:line=>{
      diagnostics.push(line);
      if(scenario==='cancel-exit78'&&line==='CONFINEMENT_FAILURE:NATIVE_CONFINEMENT')cancellation.abort();
      if(scenario==='cancel-native-exit78'&&line==='CONFINEMENT_NATIVE_EXIT:78')cancellation.abort();
    },
    runJob:async(input,options)=>{
      if(options.probe)return{ok:true,checks:Array(19).fill('synthetic'),syscallReport:{negativeSyscalls:31}};
      try{return await runConfinedJob(input,{...options,timeoutMs:scenario==='timeout-native-exit78'?2500:3000,onLifetime:()=>{lifetimes++;},...(fault?{fault:'orphan'}:{})});}
      catch(error){runnerError={code:error.code,status:error.status};throw error;}
    },
  });
  await service.initialize();
  service.setFatalHandler(createFatalLifecycle({
    getServer:()=>({close:()=>events.push('listener-closed'),closeAllConnections:()=>events.push('connections-closed')}),
    stop:()=>{events.push('stop');return service.stop();},exit:code=>events.push(`exit:${code}`),
    setTimer:fn=>{deadline=fn;return 1;},clearTimer:()=>events.push('deadline-cleared'),
  }));
  let serviceError;
  const started=performance.now();
  try{await service.convert(Buffer.alloc(0),{signal:cancellation.signal});}catch(error){serviceError={status:error.status,code:error.code};}
  await new Promise(setImmediate);
  if(!service.isReady()) {
    service.markUnhealthy();deadline?.();
    try{await service.convert(Buffer.alloc(0));}catch{}
  }
  const entries=await actual.readdir(root);
  console.log(JSON.stringify({workerExit,workerFrame,runnerError,serviceError,ready:service.isReady(),events,diagnostics,spawned,entries,lifetimes,workerStderr,elapsedMs:performance.now()-started}));
} finally {
  process.kill=kill;
  for(const {child,closed} of children.values())if(!closed)child.kill('SIGKILL');
  await actual.rm(root,{recursive:true,force:false});
}
