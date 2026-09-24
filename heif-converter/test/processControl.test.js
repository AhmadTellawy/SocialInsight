import assert from 'node:assert/strict';
import test from 'node:test';
import { runStartupProcessControl, validateProcessControl } from '../src/processControl.js';
import { processControlFixture } from './processControlFixture.js';
import { createFatalLifecycle } from '../src/bootstrap.js';

const report = (limit, kind) => ({ limit, soft: limit, hard: limit, kind, created: 1,
  error: 'EAGAIN', raiseDenied: true, inheritancePassed: true, escapeDenied: true,
  cleanupPassed: true, gatewayInstalled: true });
test('startup serially proves both mechanisms at both limits and cleans/checks counters between each', async () => {
  const order = [];
  const result = await runStartupProcessControl({}, {
    probe: async (limit, kind) => { order.push(`${limit}:${kind}`); return report(limit, kind); },
    checkRoot: async () => { order.push('root'); }, checkCounters: async () => { order.push('counters'); },
  });
  assert.deepEqual(result, processControlFixture);
  assert.deepEqual(order, ['root','counters','128:forks','counters','root','128:threads','counters','root',
    '32:forks','counters','root','32:threads','counters','root']);
});
test('partial, zero-task, excess-task, wrong-limit, cleanup and resource failures never produce readiness', async () => {
  for (const change of [{created:0},{created:129},{hard:32},{soft:32},{error:'ENOMEM'},
    {gatewayInstalled:false},{inheritancePassed:false},{raiseDenied:false},{escapeDenied:false},{cleanupPassed:false}]) {
    await assert.rejects(runStartupProcessControl({}, { probe:async(limit,kind)=>({...report(limit,kind),...change}),
      checkRoot:async()=>{},checkCounters:async()=>{} }));
  }
  for (const key of ['checkRoot','checkCounters']) await assert.rejects(runStartupProcessControl({}, {
    probe: async(limit,kind)=>report(limit,kind),checkRoot:async()=>{},checkCounters:async()=>{},
    [key]:async()=>{throw Error('resource failure');},
  }));
});
test('producer strictly rejects every missing/false field and any extra inventory or attribution claim', () => {
  for (const key of Object.keys(processControlFixture)) {
    const copy={...processControlFixture}; delete copy[key];assert.throws(()=>validateProcessControl(copy));
    assert.throws(()=>validateProcessControl({...processControlFixture,[key]:false}));
  }
  assert.throws(()=>validateProcessControl({...processControlFixture,attribution:'EXACT'}));
  assert.throws(()=>validateProcessControl({...processControlFixture,pid:123}));
});
test('fatal callback closes listener synchronously, waits for cleanup, exits nonzero exactly once', async () => {
  const order=[];let release,deadline;const cleanup=new Promise(resolve=>{release=resolve;});
  const fatal=createFatalLifecycle({getServer:()=>({close:()=>order.push('close'),closeAllConnections:()=>order.push('connections')}),
    stop:()=>{order.push('stop');return cleanup;},exit:code=>order.push(`exit:${code}`),
    setTimer:callback=>{deadline=callback;return 1;},clearTimer:()=>order.push('clear')});
  fatal();fatal();assert.deepEqual(order,['close','connections']);
  await Promise.resolve();assert.deepEqual(order,['close','connections','stop']);
  release();await new Promise(setImmediate);deadline();
  assert.deepEqual(order,['close','connections','stop','clear','exit:1']);
});
test('fatal deadline exits even when cleanup hangs', () => {
  let deadline;const exits=[];
  const fatal=createFatalLifecycle({getServer:()=>undefined,stop:()=>new Promise(()=>{}),
    exit:code=>exits.push(code),setTimer:fn=>{deadline=fn;},clearTimer:()=>{}});
  fatal();deadline();deadline();assert.deepEqual(exits,[1]);
});
