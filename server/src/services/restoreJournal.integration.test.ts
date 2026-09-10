import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { GROUP_ROLES } from '../utils/constants';

for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const target = new URL(process.env[name] || 'http://invalid');
  assert.equal(target.protocol, 'postgresql:'); assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '55447'); assert.equal(target.pathname, '/settings_test');
  for (const key of target.searchParams.keys()) assert.ok(['schema', 'connection_limit', 'pool_timeout'].includes(key));
  assert.equal(target.searchParams.get('schema') || 'public', 'public');
}
process.env.NODE_ENV = 'test';
const prisma = require('../prisma').default as typeof import('../prisma').default;
const { purgeAccount } = require('./accountErasureService') as typeof import('./accountErasureService');
const { appendDeletionDecision, normalizeDeletionDecision } = require('./deletionJournalService') as typeof import('./deletionJournalService');
const { purgeMediaAsset } = require('./mediaService') as typeof import('./mediaService');
const { resumeAccountCleanupJobs } = require('./accountCleanupService') as typeof import('./accountCleanupService');
const { setMediaStorageForTests } = require('./mediaStorage') as typeof import('./mediaStorage');
const users: string[] = [], assets: string[] = [], groups: string[] = [];
const objects = new Set<string>();
let failStorage = false, afterRemove: (() => Promise<void>) | undefined;
setMediaStorageForTests({
  createSignedUpload: async () => { throw new Error('unused'); }, download: async () => { throw new Error('unused'); },
  upload: async () => { throw new Error('unused'); }, copy: async () => { throw new Error('unused'); },
  createSignedReadUrl: async () => { throw new Error('unused'); }, getPublicUrl: () => { throw new Error('unused'); }, provisionBuckets: async () => {},
  remove: async (bucket, keys) => {
    if (failStorage) throw new Error('Synthetic storage failure');
    for (const key of keys) objects.delete(`${bucket}/${key}`);
    if (afterRemove) { const action = afterRemove; afterRemove = undefined; await action(); }
  }
});
after(async () => {
  setMediaStorageForTests();
  await prisma.deletionDecision.deleteMany({ where: { subjectId: { in: [...users, ...assets] } } });
  await prisma.groupMember.deleteMany({ where: { groupId: { in: groups } } });
  await prisma.group.deleteMany({ where: { id: { in: groups } } });
  await prisma.mediaAsset.deleteMany({ where: { id: { in: assets } } });
  await prisma.handleAlias.deleteMany({ where: { handle: { in: users.map(id => `rj_${id.replace(/-/g, '')}`) } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
async function fixture(withMedia = true) {
  const id = randomUUID(); users.push(id);
  const user = await prisma.user.create({ data: { id, name: 'Synthetic journal fixture', handle: `rj_${id.replace(/-/g, '')}`,
    email: `${id}@example.invalid`, emailVerifiedAt: new Date(), status: 'ACTIVE', bio: 'Erase this private profile field' } });
  await prisma.handleAlias.create({ data: { handle: user.handle!, userId: id } });
  if (!withMedia) return { user, asset: null };
  const assetId = randomUUID(); assets.push(assetId);
  const uploadKey = `${id}/${assetId}/upload.heic`, storageKey = `${id}/${assetId}/master.webp`;
  const asset = await prisma.mediaAsset.create({ data: { id: assetId, ownerId: id, purpose: 'POST', status: 'READY', sourceMime: 'image/heic',
    altText: 'Private image description', checksum: 'synthetic-checksum', uploadBucket: 'media-originals', uploadKey,
    variants: { create: { kind: 'MASTER', storageBucket: 'media-originals', storageKey, width: 20, height: 20, mime: 'image/webp', byteSize: 100 } } }, include: { variants: true } });
  for (const key of [uploadKey, storageKey, `${id}/${assetId}/prepared.webp`]) objects.add(`media-originals/${key}`);
  return { user, asset };
}
const transaction = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(run, { timeout: 20_000, maxWait: 10_000 });

test('logical erasure and journal both roll back when either journal insertion or final purge write fails', async () => {
  const { user, asset } = await fixture(), decisionId = randomUUID();
  await assert.rejects(transaction(tx => purgeAccount(new Proxy(tx, { get(target, property) {
    if (property === 'deletionDecision') return new Proxy(target.deletionDecision, { get(model, operation) {
      if (operation === 'create') return async () => { throw new Error('Synthetic journal failure'); };
      return Reflect.get(model, operation);
    } });
    return Reflect.get(target, property);
  } }), user.id, { decisionId })), /Synthetic journal failure/);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status, 'ACTIVE');
  assert.equal(await prisma.deletionDecision.count({ where: { id: decisionId } }), 0);
  await assert.rejects(transaction(tx => purgeAccount(new Proxy(tx, { get(target, property) {
    if (property === 'user') return new Proxy(target.user, { get(model, operation) {
      if (operation === 'update') return async () => { throw new Error('Synthetic final purge failure'); };
      return Reflect.get(model, operation);
    } });
    return Reflect.get(target, property);
  } }), user.id, { decisionId })), /Synthetic final purge failure/);
  assert.equal(await prisma.deletionDecision.count({ where: { id: decisionId } }), 0);
  assert.equal(await prisma.accountCleanupJob.count({ where: { userId: user.id } }), 0);
  assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset!.id } })).status, 'READY');
  assert.equal((await prisma.handleAlias.findUniqueOrThrow({ where: { handle: user.handle! } })).userId, user.id);
});

test('account decision keeps original minimized media keys after complete physical cleanup and job expiry', async () => {
  const { user, asset } = await fixture(), decisionId = randomUUID();
  const result = await transaction(tx => purgeAccount(tx, user.id, { decisionId }));
  assert.deepEqual(result.unresolvedGroupIds, []);
  const captured = result.decision.resourcePointers;
  assert.equal(JSON.stringify(captured).includes(user.email!), false);
  assert.equal(JSON.stringify(captured).includes('Private image'), false);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email, null);
  await purgeMediaAsset(asset!.id);
  assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset!.id } })).uploadKey, null);
  assert.equal(await prisma.mediaVariant.count({ where: { mediaAssetId: asset!.id } }), 0);
  await prisma.accountCleanupJob.deleteMany({ where: { userId: user.id } });
  assert.deepEqual((await prisma.deletionDecision.findUniqueOrThrow({ where: { id: decisionId } })).resourcePointers, captured);
  assert.equal((captured as any).media[0].objects.length, 3);
});

test('trusted restoration replay removes resurrected credentials without historical session and reports sole-owner groups', async () => {
  const { user } = await fixture(false), decisionId = randomUUID();
  const first = await transaction(tx => purgeAccount(tx, user.id, { decisionId }));
  const { recordedAt: _recordedAt, ...scope } = first.decision;
  const replay = normalizeDeletionDecision(scope);
  await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', email: user.email, bio: 'Resurrected profile', deletedAt: null, passwordHash: 'synthetic-restored-hash' } });
  const group = await prisma.group.create({ data: { name: 'Synthetic restore group', description: 'Fixture', category: 'test', members: { create: { userId: user.id, role: GROUP_ROLES.OWNER, status: 'JOINED' } } } }); groups.push(group.id);
  const second = await transaction(tx => purgeAccount(tx, user.id, { decisionId, replay }));
  assert.deepEqual(second.unresolvedGroupIds, [group.id]);
  const erased = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(erased.status, 'DELETED'); assert.equal(erased.passwordHash, null); assert.equal(erased.bio, null);
  assert.equal(await prisma.groupMember.count({ where: { groupId: group.id } }), 0);
  assert.equal(+second.decision.recordedAt, +first.decision.recordedAt);
  await transaction(tx => purgeAccount(tx, user.id, { decisionId, replay }));
  assert.equal(await prisma.deletionDecision.count({ where: { id: decisionId } }), 1);
  await assert.rejects(transaction(tx => purgeAccount(tx, user.id, { decisionId, replay: { ...replay, subjectId: randomUUID() } })), /DELETION_DECISION_CONFLICT/);
});

test('concurrent same-ID journal attempts create one row and conflicting reuse leaves that row unchanged', async () => {
  const { user } = await fixture(false);
  const input = normalizeDeletionDecision({ id: randomUUID(), subjectKind: 'ACCOUNT', subjectId: user.id, action: 'ACCOUNT_ERASE', resourcePointers: { media: [] } });
  const rows = await Promise.all(Array.from({ length: 5 }, () => transaction(tx => appendDeletionDecision(tx, input))));
  assert.equal(new Set(rows.map(row => +row.recordedAt)).size, 1);
  assert.equal(await prisma.deletionDecision.count({ where: { id: input.id } }), 1);
  await assert.rejects(transaction(tx => appendDeletionDecision(tx, { ...input, subjectId: randomUUID() })), /DELETION_DECISION_CONFLICT/);
  assert.equal((await prisma.deletionDecision.findUniqueOrThrow({ where: { id: input.id } })).subjectId, user.id);
});

test('storage failure and unexpired write capability preserve exact retry pointers and journal intent', async () => {
  const { asset } = await fixture();
  await prisma.mediaAsset.update({ where: { id: asset!.id }, data: { storageCleanupNotBefore: new Date(Date.now() + 60_000) } });
  failStorage = true;
  try { await assert.rejects(purgeMediaAsset(asset!.id), /Synthetic storage failure/); } finally { failStorage = false; }
  assert.equal(await prisma.deletionDecision.count({ where: { subjectId: asset!.id } }), 1);
  await purgeMediaAsset(asset!.id);
  const pending = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset!.id } });
  assert.equal(pending.status, 'PENDING_DELETE'); assert.ok(pending.uploadKey);
  const decision = await prisma.deletionDecision.findFirstOrThrow({ where: { subjectId: asset!.id } });
  assert.ok((decision.resourcePointers as any).media[0].deleteNotBefore);
  await prisma.mediaAsset.update({ where: { id: asset!.id }, data: { storageCleanupNotBefore: new Date(Date.now() - 1) } });
  await purgeMediaAsset(asset!.id);
  assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset!.id } })).status, 'DELETED');
  const count = await prisma.deletionDecision.count({ where: { subjectId: asset!.id } });
  await purgeMediaAsset(asset!.id);
  assert.equal(await prisma.deletionDecision.count({ where: { subjectId: asset!.id } }), count);
});

test('a newly registered key after storage deletion is retained for a separately journaled retry batch', async () => {
  const { asset } = await fixture();
  const key = `${asset!.ownerId}/${asset!.id}/private/480.webp`;
  afterRemove = async () => {
    await prisma.mediaVariant.create({ data: { mediaAssetId: asset!.id, kind: 'SMALL', storageBucket: 'media-private', storageKey: key, width: 480, height: 480, mime: 'image/webp', byteSize: 50 } });
    objects.add(`media-private/${key}`);
  };
  await purgeMediaAsset(asset!.id);
  assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset!.id } })).status, 'PENDING_DELETE');
  assert.ok(objects.has(`media-private/${key}`));
  await purgeMediaAsset(asset!.id);
  assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset!.id } })).status, 'DELETED');
  assert.equal(objects.has(`media-private/${key}`), false);
  assert.equal(await prisma.deletionDecision.count({ where: { subjectId: asset!.id } }), 2);
});

test('journal unavailability prevents a media purge from changing its row or issuing storage deletion', async () => {
  const { asset } = await fixture(), initialObjects = new Set(objects);
  const original = prisma.$transaction;
  (prisma as any).$transaction = (run: any, ...options: any[]) => Reflect.apply(original, prisma, [async (tx: Prisma.TransactionClient) => run(new Proxy(tx, {
    get(target, property) {
      if (property === 'deletionDecision') return new Proxy(target.deletionDecision, { get(model, operation) {
        if (operation === 'findUnique') return async () => { throw new Error('Synthetic journal unavailable'); };
        return Reflect.get(model, operation);
      } });
      return Reflect.get(target, property);
    }
  })), ...options]);
  try { await assert.rejects(purgeMediaAsset(asset!.id), /Synthetic journal unavailable/); }
  finally { (prisma as any).$transaction = original; }
  assert.deepEqual(objects, initialObjects);
  assert.equal((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset!.id } })).status, 'READY');
});

test('a captured decision survives replay when the restored snapshot has no subject row', async () => {
  const id = randomUUID(); users.push(id);
  const replay = normalizeDeletionDecision({ id: randomUUID(), subjectKind: 'ACCOUNT', subjectId: id, action: 'ACCOUNT_ERASE', resourcePointers: { media: [] } });
  const result = await transaction(tx => purgeAccount(tx, id, { decisionId: replay.id, replay }));
  assert.deepEqual(result.unresolvedGroupIds, []);
  assert.equal(result.decision.subjectId, id);
  assert.equal(await prisma.user.count({ where: { id } }), 0);
  assert.equal(await prisma.deletionDecision.count({ where: { id: replay.id } }), 1);
});

test('cleanup completion does not discard a media ID added while its original storage batch runs', async () => {
  const { user, asset } = await fixture();
  await transaction(tx => purgeAccount(tx, user.id, { decisionId: randomUUID() }));
  const job = await prisma.accountCleanupJob.findUniqueOrThrow({ where: { userId: user.id } });
  const extraId = randomUUID(); assets.push(extraId);
  afterRemove = async () => {
    await prisma.mediaAsset.create({ data: { id: extraId, ownerId: user.id, purpose: 'POST', status: 'PENDING_DELETE' } });
    await prisma.accountCleanupJob.update({ where: { id: job.id }, data: { mediaIds: [asset!.id, extraId] } });
  };
  const findMany = prisma.accountCleanupJob.findMany;
  (prisma.accountCleanupJob as any).findMany = async () => [job];
  try { await resumeAccountCleanupJobs(); }
  finally { (prisma.accountCleanupJob as any).findMany = findMany; }
  const current = await prisma.accountCleanupJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(current.completedAt, null);
  assert.deepEqual(current.mediaIds, [asset!.id, extraId]);
});
