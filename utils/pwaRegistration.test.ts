import assert from 'node:assert/strict';
import test from 'node:test';
import { registerPwa } from './pwaRegistration.ts';

test('PWA registration never installs an automatic reload callback that can abort active uploads', () => {
  let options: Record<string, unknown> | undefined;
  const result = registerPwa((candidate) => {
    options = candidate;
    return 'registered';
  });

  assert.equal(result, 'registered');
  assert.equal(options?.immediate, true);
  assert.equal(typeof options?.onOfflineReady, 'function');
  assert.equal('onNeedRefresh' in (options ?? {}), false);
});
