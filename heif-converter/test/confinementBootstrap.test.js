import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyResourceEnvelope } from '../src/confinementBootstrap.js';

const io = (overrides={}) => ({ readFile: async name => {
  const values={
    '/proc/self/cgroup':'0::/',
    '/proc/self/mountinfo':'1 0 0:1 / /sys/fs/cgroup ro - cgroup2 cgroup rw',
    '/sys/fs/cgroup/memory.max':'536870912',
    '/sys/fs/cgroup/memory.swap.max':'0',
    '/sys/fs/cgroup/pids.max':'512',
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
