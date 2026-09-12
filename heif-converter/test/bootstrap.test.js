import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapConverterService } from '../src/bootstrap.js';

const config = { tempRoot: '/tmp/test', port: 8080, host: '127.0.0.1' };

test('does not create or listen on a server when the native startup probe fails', async () => {
  let created = false;
  await assert.rejects(bootstrapConverterService({
    loadConfig: () => config,
    mkdir: async () => undefined,
    converter: {},
    loadHealthEvidence: async () => ({ status: 'ready' }),
    runStartupNativeProbe: async () => { throw new Error('native probe failed'); },
    createConverterServer: () => { created = true; return { listen() {} }; },
    logger: { info() {} },
  }), /native probe failed/);
  assert.equal(created, false);
});

test('opens the listener only after health and native evidence pass', async () => {
  const order = [];
  const nativeProbe = { status: 'passed', fixtureSet: 'native-still-v1', cases: [], elapsedMs: 1 };
  const result = await bootstrapConverterService({
    loadConfig: () => config,
    mkdir: async () => { order.push('mkdir'); },
    converter: {},
    loadHealthEvidence: async () => { order.push('health'); return { status: 'ready' }; },
    runStartupNativeProbe: async () => { order.push('native'); return nativeProbe; },
    createConverterServer: ({ healthEvidence }) => {
      order.push('server');
      assert.equal(healthEvidence.nativeProbe, nativeProbe);
      return { listen(_port, _host, callback) { order.push('listen'); callback(); } };
    },
    logger: { info() {} },
  });
  assert.deepEqual(order, ['mkdir', 'health', 'native', 'server', 'listen']);
  assert.equal(result.healthEvidence.nativeProbe, nativeProbe);
});
