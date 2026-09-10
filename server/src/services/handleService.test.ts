import assert from 'node:assert/strict';
import test from 'node:test';
import { assertHandleAvailable, claimHandle, HandleError, normalizeHandle, reserveRenamedHandle, resolveHandleUserId } from './handleService';

const namespace = (initial: Array<[string, string | null]> = []) => {
    const claims = new Map(initial);
    const tx: any = {
        $executeRaw: async () => {},
        handleAlias: {
            findUnique: async ({ where }: any) => claims.has(where.handle) ? { userId: claims.get(where.handle) } : null,
            create: async ({ data }: any) => { assert.equal(claims.has(data.handle), false); claims.set(data.handle, data.userId); }
        },
        user: { findFirst: async () => null }
    };
    return { tx, claims };
};

test('username policy normalizes ASCII case, preserves dots, and denies protected or malformed identities', () => {
    assert.equal(normalizeHandle('  Some.Name_1 '), 'some.name_1');
    for (const input of ['ad', 'a'.repeat(31), 'a-b', 'مستخدم', '<tag>', null, 'ADMIN', 'support', 'deleted_someone']) {
        assert.throws(() => normalizeHandle(input), HandleError);
    }
});

test('rename reserves both names and own former aliases can be reclaimed', async () => {
    const { tx, claims } = namespace([['first_name', 'owner']]);
    await reserveRenamedHandle(tx, 'owner', 'first_name', 'second_name');
    assert.equal(claims.get('first_name'), 'owner');
    assert.equal(claims.get('second_name'), 'owner');
    await reserveRenamedHandle(tx, 'owner', 'second_name', 'first_name');
    assert.equal(claims.size, 2);
});

test('registration, OAuth and other accounts cannot claim former names or deleted tombstones', async () => {
    const { tx, claims } = namespace([['old_name', 'owner'], ['deleted_name', null]]);
    for (const handle of ['old_name', 'deleted_name']) {
        await assert.rejects(assertHandleAvailable(tx, handle), (error: any) => error.code === 'HANDLE_UNAVAILABLE');
        await assert.rejects(reserveRenamedHandle(tx, 'other', 'other_name', handle), HandleError);
        await assert.rejects(claimHandle(tx, handle, 'other'), HandleError);
    }
    assert.equal(claims.size, 2);
});

test('an unseeded legacy current handle still blocks a case-insensitive collision', async () => {
    const { tx } = namespace();
    tx.user.findFirst = async ({ where }: any) => { assert.equal(where.handle.mode, 'insensitive'); return { id: 'legacy' }; };
    await assert.rejects(assertHandleAvailable(tx, 'legacyname'), HandleError);
});

test('old profile URLs resolve the stable owner, while tombstones never fall through', async () => {
    const { tx } = namespace([['former.name', 'owner'], ['retired_name', null]]);
    tx.user.findFirst = async () => { throw new Error('Must not fall through a claim'); };
    assert.equal(await resolveHandleUserId(tx, '@FORMER.Name'), 'owner');
    assert.equal(await resolveHandleUserId(tx, 'retired_name'), null);
    assert.equal(await resolveHandleUserId(tx, '@invalid/route'), null);
});
