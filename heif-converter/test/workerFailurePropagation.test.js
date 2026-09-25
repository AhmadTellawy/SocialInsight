import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function run(scenario) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('./helpers/workerFailureHarness.js',import.meta.url)),scenario],{stdio:['ignore','pipe','pipe']});
    let out='',err='';const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
    child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
    child.once('error',reject);child.once('close',code=>{
      clearTimeout(timer);try{assert.equal(code,0,err);resolve(JSON.parse(out));}catch(error){reject(error);}
    });
  });
}
for(const scenario of ['exit78','spawn-error','spawn-throw','fault-exit78','fault-spawn-error','fault-spawn-throw'])test(`real worker/runner fatal propagation: ${scenario}`,async()=>{
  const r=await run(scenario);
  assert.equal(r.workerExit,78,r.workerStderr);assert.deepEqual(r.runnerError,{code:'CONFINEMENT_UNAVAILABLE',status:503});
  if(!scenario.startsWith('fault-'))assert.deepEqual(r.workerFrame,{ok:false,code:'CONFINEMENT_UNAVAILABLE',bytes:0});
  assert.equal(r.serviceError.status,503);assert.equal(r.ready,false);assert.equal(r.spawned,1);
  assert.deepEqual(r.events,['listener-closed','connections-closed','stop','deadline-cleared','exit:1']);
  assert.deepEqual(r.entries,[]);
});
test('cancellation cannot downgrade an observed native confinement failure to recoverable 499',async()=>{
  const r=await run('cancel-exit78');
  assert.deepEqual(r.runnerError,{code:'CONFINEMENT_UNAVAILABLE',status:503});
  assert.equal(r.ready,false);assert.equal(r.spawned,1);
  assert.deepEqual(r.events,['listener-closed','connections-closed','stop','deadline-cleared','exit:1']);
  assert.deepEqual(r.entries,[]);
});
for(const trigger of ['cancel','timeout'])test(`${trigger} after earliest native78 diagnostic remains fatal before any later failure frame`,async()=>{
  const r=await run(`${trigger}-native-exit78`);
  assert.ok(r.diagnostics.includes('CONFINEMENT_NATIVE_EXIT:78'));
  assert.ok(!r.diagnostics.some(line=>line.startsWith('CONFINEMENT_FAILURE:')));
  assert.equal(r.workerFrame,undefined,'worker must be killed in the pre-frame gap');
  assert.deepEqual(r.runnerError,{code:'CONFINEMENT_UNAVAILABLE',status:503});
  assert.equal(r.ready,false);assert.equal(r.spawned,1);
  assert.deepEqual(r.events,['listener-closed','connections-closed','stop','deadline-cleared','exit:1']);
  assert.deepEqual(r.entries,[]);
});
test('real malformed-native rejection remains recoverable 422 without closing listener',async()=>{
  const r=await run('malformed');
  assert.equal(r.workerExit,1);assert.deepEqual(r.runnerError,{code:'IMAGE_PROCESSING_FAILED',status:422});
  assert.deepEqual(r.workerFrame,{ok:false,code:'IMAGE_PROCESSING_FAILED',bytes:0});
  assert.equal(r.serviceError.status,422);assert.equal(r.ready,true);assert.deepEqual(r.events,[]);assert.deepEqual(r.entries,[]);
});
test('orphan fixture helper close ends actual fault worker instead of leaking its keepalive interval',async()=>{
  const r=await run('fault-orphan-close');
  assert.equal(r.workerExit,1);assert.deepEqual(r.runnerError,{code:'IMAGE_PROCESSING_FAILED',status:422});
  assert.equal(r.ready,true);assert.deepEqual(r.events,[]);assert.deepEqual(r.entries,[]);
  assert.equal(r.lifetimes,1);
  assert.ok(r.elapsedMs<3000,'must complete before the runner timeout');
});
