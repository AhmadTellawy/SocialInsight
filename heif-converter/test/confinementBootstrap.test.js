import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyResourceEnvelope, parseCounters, verifyResourceCounters } from '../src/confinementBootstrap.js';

const io = (overrides={}) => ({ open: async()=>{throw Object.assign(new Error('read only'),{code:'EROFS'});}, readFile: async name => {
  const values={
    '/proc/self/cgroup':'0::/',
    '/proc/self/mountinfo':'1 0 0:1 / /sys/fs/cgroup ro - cgroup2 cgroup rw',
    '/sys/fs/cgroup/memory.max':'536870912',
    '/sys/fs/cgroup/memory.swap.max':'0',
    '/sys/fs/cgroup/pids.max':'512',
    '/sys/fs/cgroup/pids.current':'2',
    '/sys/fs/cgroup/pids.events':'max 0',
    '/sys/fs/cgroup/cpu.max':'50000 100000',
    '/sys/fs/cgroup/memory.events':'oom 0\noom_kill 0',
    ...overrides,
  };
  if(!(name in values))throw new Error('Unexpected file');
  return values[name];
}});

test('resource diagnostics identify failed limits without changing the accepted envelope',async()=>{
  const envelope=await verifyResourceEnvelope(io());
  assert.equal(envelope.memoryBytes,536870912);assert.equal(envelope.cpuQuota,0.5);
  for(const [file,value,phase] of [
    ['memory.max','1073741824','MEMORY_LIMIT'],
    ['memory.max','134217728','MEMORY_LIMIT'],
    ['memory.swap.max','max','SWAP_LIMIT'],
    ['pids.max','max','PIDS_LIMIT'],
    ['cpu.max','max 100000','CPU_LIMIT'],
  ])await assert.rejects(verifyResourceEnvelope(io({[`/sys/fs/cgroup/${file}`]:value})),e=>e.phase===phase && e.status===503);
  await assert.rejects(verifyResourceEnvelope(io({'/proc/self/cgroup':'1:memory:/'})),e=>e.phase==='CGROUP_LAYOUT');
});

test('finite large PID backstop is accepted but malformed, missing and ambiguous controls fail closed',async()=>{
  assert.equal((await verifyResourceEnvelope(io({'/sys/fs/cgroup/pids.max':'37638'}))).pids,37638);
  for(const value of ['0','-1','1x','1.0','1e3','9007199254740992'])await assert.rejects(verifyResourceEnvelope(io({'/sys/fs/cgroup/pids.max':value})));
  await assert.rejects(verifyResourceEnvelope(io({'/proc/self/cgroup':'0::/\n0::/other'})));
  let closed=false;
  await assert.rejects(verifyResourceEnvelope({...io(),open:async(_path,flags)=>{
    assert.equal(flags,1);return{close:async()=>{closed=true;}};
  }}),error=>error.phase==='CGROUP_WRITABLE');
  assert.equal(closed,true);
});
test('strict PID/OOM baseline checking accepts the observed PID baseline without assuming a provider count',async()=>{
  const resources=await verifyResourceEnvelope(io());
  assert.equal(resources.counterBaselines[0].pidsCurrent,2);
  assert.deepEqual(await verifyResourceCounters(resources,io()),resources.counterBaselines);
});

test('strict PID/OOM reconciliation rejects unreaped PID drift and changed or malformed counters',async()=>{
  const resources=await verifyResourceEnvelope(io());
  for(const [name,value] of [['pids.current','3'],['pids.current','1'],['pids.events','max 1'],
    ['memory.events','oom 1\noom_kill 0'],['memory.events','oom 0\noom_kill 1'],
    ['pids.current','max'],['pids.events','max 0\nmax 0']]) {
    await assert.rejects(verifyResourceCounters(resources,io({[`/sys/fs/cgroup/${name}`]:value})));
  }
  for(const text of ['max 0\nmax 0','max -1','max 01','max 1x','other 0','max 9007199254740992'])assert.throws(()=>parseCounters(text,['max']));
});
