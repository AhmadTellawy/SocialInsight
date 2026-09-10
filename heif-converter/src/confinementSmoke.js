// Credential-free Linux prototype harness. Never imported by the HTTP broker.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { runConfinedJob } from './confinedRunner.js';

const cases=[];
const helper='/usr/local/bin/si-heif-confine';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const absent=pid=>assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH');
if(process.env.SI_CONFINEMENT_DEATH_PROBE==='1') {
  let worker;
  await runConfinedJob(Buffer.alloc(0),{fault:'hold',onSpawn:pid=>{worker=pid;},onLifetime:descendant=>{
    process.stdout.write(JSON.stringify({worker,descendant})+'\n',()=>process.kill(process.pid,'SIGKILL'));
  }});
  process.exit(1);
}
async function record(name,fn){const start=performance.now();try{const details=await fn();cases.push({name,status:'PASS',ms:Math.round(performance.now()-start),...details});console.log(JSON.stringify(cases.at(-1)));}catch(e){cases.push({name,status:'FAIL',ms:Math.round(performance.now()-start),code:e.code??'ASSERTION'});console.log(JSON.stringify(cases.at(-1)));throw e;}}
try {
  await record('enforced-container-memory',async()=>{
    const limit=(await fs.readFile('/sys/fs/cgroup/memory.max','utf8')).trim();
    assert.notEqual(limit,'max');assert.ok(Number(limit)>0&&Number(limit)<=512*1024*1024);
    return{bytes:Number(limit)};
  });
  await record('whole-worker-confinement',async()=>({probe:await runConfinedJob(Buffer.alloc(0),{probe:true,onDiagnostic:code=>console.log(JSON.stringify({diagnostic:code}))})}));
  await record('actual-non-pid1-parent-adoption-race',async()=>{
    const report=await new Promise((resolve,reject)=>{
      const child=spawn(helper,['--parent-race-probe'],{env:{},stdio:['ignore','pipe','ignore']});
      let output='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Race deadline'));},5000);
      child.stdout.on('data',b=>{output+=b.toString();});child.on('error',reject);
      child.on('close',code=>{clearTimeout(timer);try{assert.equal(code,0);resolve(JSON.parse(output));}catch(e){reject(e);}});
    });
    assert.equal(report.actualAdoption,true);assert.equal(report.nonPid1Subreaper,true);return report;
  });
  await record('actual-orphaned-fork-reaped',async()=>{
    let worker,descendant;
    await assert.rejects(runConfinedJob(Buffer.alloc(0),{fault:'orphan',onSpawn:pid=>{worker=pid;},onLifetime:pid=>{descendant=pid;}}),e=>e.code==='IMAGE_PROCESSING_FAILED');
    assert.ok(descendant>1);absent(worker);absent(descendant);return{workerGone:true,orphanGone:true};
  });
  await record('actual-broker-death-fork-reaped',async()=>{
    const before=await fs.readdir('/tmp/heif-converter');
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(helper,['--supervise-probe'],{env:{SI_CONFINEMENT_DEATH_PROBE:'1'},stdio:['ignore','pipe','pipe']});
      let output='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Supervisor deadline'));},5000);
      child.stdout.on('data',b=>{output+=b.toString();});child.stderr.resume();child.on('error',reject);
      child.on('close',code=>{clearTimeout(timer);try{assert.equal(code,1);resolve(JSON.parse(output));}catch(e){reject(e);}});
    });
    absent(result.worker);absent(result.descendant);
    const residual=(await fs.readdir('/tmp/heif-converter')).filter(name=>!before.includes(name));
    assert.equal(residual.length,1);assert.match(residual[0],/^job-[A-Za-z0-9]+$/);
    const dir='/tmp/heif-converter/'+residual[0];
    assert.deepEqual((await fs.readdir(dir)).sort(),['decoded.png','input.heic']);
    // The killed broker cannot execute finally. Only this trusted test owner
    // removes its exact synthetic job after independently proving quiescence.
    await fs.rm(dir,{recursive:true,force:false});
    return{workerGone:true,orphanGone:true,brokerFinallyUnavailable:true,syntheticResidualRemoved:true};
  });
  for(const fault of ['hang','stdout','stderr'])await record('actual-worker-'+fault+'-bounded',async()=>{
    let pid;const expected=fault==='hang'?'CONVERSION_TIMEOUT':'INVALID_WORKER_OUTPUT';
    await assert.rejects(runConfinedJob(Buffer.alloc(0),{fault,timeoutMs:fault==='hang'?1500:10000,onSpawn:value=>{pid=value;}}),e=>e.code===expected);
    absent(pid);return{typedFailure:expected,workerGone:true};
  });
  const camera=Buffer.from(await fs.readFile('/fixtures/fixtures/camera-sample.base64','utf8'),'base64');
  for(const [name,input] of [['camera',camera],['aperture',await fs.readFile('/fixtures/fixtures/rainbow-451x461.heic')],['alpha',await fs.readFile('/fixtures/fixtures/with-alpha-512x512.heic')]]) {
    await record('native-sharp-'+name,async()=>{
      const result=await runConfinedJob(input);
      assert.equal(result.mime,'image/webp');assert.ok(result.data.length>0);
      return{width:result.width,height:result.height,bytes:result.data.length,sha256:crypto.createHash('sha256').update(result.data).digest('hex')};
    });
  }
  await record('actual-cancel-and-reap',async()=>{
    const controller=new AbortController();let pid;
    await assert.rejects(runConfinedJob(camera,{signal:controller.signal,onSpawn:value=>{pid=value;setTimeout(()=>controller.abort(),150);}}),e=>e.code==='CONVERSION_CANCELLED');
    assert.throws(()=>process.kill(-pid,0),e=>e.code==='ESRCH');
  });
  await record('cleanup',async()=>{assert.deepEqual(await fs.readdir('/tmp/heif-converter'),[]);});
  console.log(JSON.stringify({status:'PASS',cases:cases.length,memoryPeak:Number((await fs.readFile('/sys/fs/cgroup/memory.peak','utf8')).trim())}));
}catch{process.exitCode=1;}
