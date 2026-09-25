import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapConverterService } from '../src/bootstrap.js';
import { processControlFixture } from './processControlFixture.js';

const config = { tempRoot: '/tmp/test', port: 8080, host: '127.0.0.1' };
const initialized = {
  processControl: processControlFixture,
  probe: {
    versions: { sharp: '0.35.4', vips: '8.18.0' },
    checks: Array.from({ length: 19 }, (_, index) => `check-${index}`),
    syscallReport: { negativeSyscalls: 31, limitsVerified: 5 },
  },
  envelope: {
    storage: { storage: 'bounded-two-inode' },
    resources: { memoryBytes: 512 * 1024 * 1024, swapBytes: 0, pids: 512, cpuQuota: 1 },
  },
};

const converter = () => ({
  initialize: async () => initialized,
  isReady: () => true,
  stop: async () => undefined,
});

test('does not create or listen on a server when the native startup probe fails', async () => {
  let created = false;
  await assert.rejects(bootstrapConverterService({
    loadConfig: () => config,
    mkdir: async () => undefined,
    converter: converter(),
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
    converter: {
      ...converter(),
      initialize: async () => { order.push('confinement'); return initialized; },
    },
    loadHealthEvidence: async (_config, options) => {
      order.push('health');
      assert.equal(options.sharpVersions, initialized.probe.versions);
      return { status: 'ready' };
    },
    runStartupNativeProbe: async () => { order.push('native'); return nativeProbe; },
    createReadinessEvidence: ({ nativeEvidence, nativeProbe: probe, processControl }) => {
      order.push('readiness');
      assert.deepEqual(nativeEvidence, { status: 'ready' });
      assert.equal(probe, nativeProbe);
      assert.deepEqual(processControl, processControlFixture);
      return { status: 'ready', service: 'heif-converter', versions: {}, nativeBuild: {}, nativeProbe: {}, confinement: { schemaVersion: 2, policy: 'rlimit-nproc-v2', status: 'passed', processControl } };
    },
    createConverterServer: ({ healthEvidence }) => {
      order.push('server');
      assert.equal(healthEvidence.confinement.schemaVersion, 2);
      assert.equal(healthEvidence.confinement.policy, 'rlimit-nproc-v2');
      assert.deepEqual(healthEvidence.confinement.processControl, processControlFixture);
      return { listen(_port, _host, callback) { order.push('listen'); callback(); } };
    },
    logger: { info() {} },
  });
  assert.deepEqual(order, ['mkdir', 'confinement', 'health', 'native', 'readiness', 'server', 'listen']);
  assert.deepEqual(Object.keys(result.healthEvidence), ['status', 'service', 'versions', 'nativeBuild', 'nativeProbe', 'confinement']);
  assert.deepEqual(Object.keys(result.healthEvidence.confinement), ['schemaVersion', 'policy', 'status', 'processControl']);
});
