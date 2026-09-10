import assert from 'node:assert/strict';
import test from 'node:test';
import { readRestoreMaintenance } from './maintenance';

test('maintenance setting rejects ambiguous values instead of exposing a restore', () => {
    assert.equal(readRestoreMaintenance({}), false);
    assert.equal(readRestoreMaintenance({ RESTORE_MAINTENANCE: 'false' }), false);
    assert.equal(readRestoreMaintenance({ RESTORE_MAINTENANCE: ' true ' }), true);
    for (const value of ['1', 'TRUE', 'enabled', 'tru']) {
        assert.throws(() => readRestoreMaintenance({ RESTORE_MAINTENANCE: value }), /must be true or false/);
    }
});
