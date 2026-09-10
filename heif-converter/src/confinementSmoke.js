// Credential-free Linux prototype harness. Never imported by the HTTP broker.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { runConfinedJob } from './confinedRunner.js';

const cases=[];
async function record(name,fn){const start=performance.now();try{const details=await fn();cases.push({name,status:'PASS',ms:Math.round(performance.now()-start),...details});console.log(JSON.stringify(cases.at(-1)));}catch(e){cases.push({name,status:'FAIL',ms:Math.round(performance.now()-start),code:e.code??'ASSERTION'});console.log(JSON.stringify(cases.at(-1)));throw e;}}
try {
  await record('enforced-container-memory',async()=>{
    const limit=(await fs.readFile('/sys/fs/cgroup/memory.max','utf8')).trim();
    assert.notEqual(limit,'max');assert.ok(Number(limit)>0&&Number(limit)<=512*1024*1024);
    return{bytes:Number(limit)};
  });
  await record('whole-worker-confinement',async()=>({probe:await runConfinedJob(Buffer.alloc(0),{probe:true})}));
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
