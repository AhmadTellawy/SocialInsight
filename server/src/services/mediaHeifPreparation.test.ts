import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import prisma from '../prisma';
import { prepareMediaUpload, finalizeMediaUpload, purgeMediaAsset } from './mediaService';
import { setMediaStorageForTests } from './mediaStorage';
import { resetHeifReadinessForTests } from './heifConversionClient';

const heifBytes = () => {
  const bytes = Buffer.alloc(57);
  bytes.writeUInt32BE(20, 0); bytes.write('ftyp', 4); bytes.write('heic', 8); bytes.write('heic', 16);
  bytes.writeUInt32BE(8, 20); bytes.write('hvcC', 24);
  bytes.writeUInt32BE(20, 28); bytes.write('ispe', 32); bytes.writeUInt32BE(40, 40); bytes.writeUInt32BE(30, 44);
  bytes.writeUInt32BE(9, 48); bytes.write('mdat', 52); bytes[56] = 1;
  return bytes;
};

async function scenario(run: (context: any) => Promise<void>) {
  const saved = { transaction: prisma.$transaction, updateMany: prisma.mediaAsset.updateMany,
    findUnique: prisma.mediaAsset.findUnique, fetch: globalThis.fetch };
  const names = ['MEDIA_HEIF_SERVER_ENABLED', 'HEIF_CONVERTER_URL', 'HEIF_CONVERTER_SECRET'];
  const env = names.map(name => process.env[name]);
  const source = heifBytes();
  const output = await sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 20, g: 80, b: 180, alpha: 0.5 } } }).webp().toBuffer();
  const context: any = { accountStatus: 'ACTIVE', source, output, conversions: 0, downloads: 0, signs: 0, locks: 0,
    objects: new Map<string, Buffer>([['owner/asset/upload.heic', source]]), removed: [],
    asset: { id: 'asset', ownerId: 'owner', purpose: 'POST', sourceMime: 'image/heic', sourceByteSize: source.length,
      sourceWidth: null, sourceHeight: null, checksum: null, uploadBucket: 'media-originals', uploadKey: 'owner/asset/upload.heic',
      status: 'TEMPORARY', accessScope: 'OWNER_ONLY', deletedAt: null, errorCode: null, updatedAt: new Date(),
      storageCleanupNotBefore: new Date(Date.now() + 7_500_000), variants: [] } };
  const matches = (where: any) => {
    const a = context.asset;
    return (!where.id || where.id === a.id) && (!where.ownerId || where.ownerId === a.ownerId)
      && (where.deletedAt === undefined || where.deletedAt === a.deletedAt)
      && (!where.errorCode || where.errorCode === a.errorCode)
      && (!where.updatedAt || +where.updatedAt === +a.updatedAt)
      && (!where.status || (typeof where.status === 'string' ? where.status === a.status : where.status.in.includes(a.status)))
      && (!where.owner || where.owner.status === context.accountStatus);
  };
  const update = ({ data }: any) => { Object.assign(context.asset, data); context.asset.updatedAt = new Date(); return structuredClone(context.asset); };
  const updateMany = async ({ where, data }: any) => { if (!matches(where)) return { count: 0 }; update({ data }); return { count: 1 }; };
  const deletionDecisions = new Map<string, any>();
  const tx: any = {
    deletionDecision: {
      findUnique: async ({ where }: any) => deletionDecisions.get(where.id) || null,
      create: async ({ data }: any) => {
        if (deletionDecisions.has(data.id)) throw new Error('Duplicate deletion decision');
        const row = { ...structuredClone(data), recordedAt: new Date() };
        deletionDecisions.set(data.id, row); return row;
      }
    },
    $executeRaw: async () => { context.locks++; }, user: { findUnique: async () => ({ status: context.accountStatus }) },
    mediaAsset: { findUnique: async () => structuredClone(context.asset), updateMany, update: async (args: any) => update(args) },
    mediaVariant: {
      create: async ({ data }: any) => { context.asset.variants.push({ id: `variant-${context.asset.variants.length}`, ...data }); return data; },
      upsert: async ({ create }: any) => {
        context.asset.variants = context.asset.variants.filter((v: any) => !(v.kind === create.kind && v.width === create.width && v.isPublic === create.isPublic));
        context.asset.variants.push({ id: `variant-${context.asset.variants.length}`, ...create }); return create;
      },
      deleteMany: async ({ where }: any) => {
        context.asset.variants = where.storageKey ? context.asset.variants.filter((v: any) => where.storageKey.notIn.includes(v.storageKey)) : [];
        return { count: 1 };
      }
    }
  };
  try {
    process.env.MEDIA_HEIF_SERVER_ENABLED = 'true'; process.env.HEIF_CONVERTER_URL = 'https://converter.test';
    process.env.HEIF_CONVERTER_SECRET = 'local-test-secret-with-at-least-32-bytes';
    resetHeifReadinessForTests();
    (prisma as any).$transaction = async (callback: any) => callback(tx);
    (prisma.mediaAsset as any).updateMany = updateMany;
    (prisma.mediaAsset as any).findUnique = tx.mediaAsset.findUnique;
    globalThis.fetch = async (url: any) => {
      if (String(url).endsWith('/health/ready')) return Response.json({ status: 'ready', service: 'heif-converter', versions: { libheif: '1.23.3', libde265: '1.1.1', sharp: '0.35.4' } });
      context.conversions++; await context.onConvert?.();
      return new Response(context.output, { headers: { 'content-type': 'image/webp' } });
    };
    setMediaStorageForTests({
      createSignedUpload: async () => { throw new Error('unused'); },
      download: async (_bucket, key) => { context.downloads++; const data = context.objects.get(key); if (!data) throw new Error('Missing object'); return data; },
      upload: async (bucket, key, body) => {
        assert.notEqual(bucket, 'media-public');
        assert.ok(context.asset.variants.some((v: any) => v.storageKey === key), 'Object registered before upload');
        context.objects.set(key, body); await context.onUpload?.(key);
      },
      copy: async () => { throw new Error('unused'); },
      remove: async (_bucket, keys) => { await context.onRemove?.(keys); for (const key of keys) { context.removed.push(key); context.objects.delete(key); } },
      createSignedReadUrl: async (bucket, key) => { assert.equal(bucket, 'media-originals'); context.signs++; await context.onSign?.(); return `https://private.invalid/${key}`; },
      getPublicUrl: () => { throw new Error('Must not publish during preparation'); },
      provisionBuckets: async () => { throw new Error('unused'); }
    });
    await run(context);
  } finally {
    (prisma as any).$transaction = saved.transaction;
    (prisma.mediaAsset as any).updateMany = saved.updateMany;
    (prisma.mediaAsset as any).findUnique = saved.findUnique;
    globalThis.fetch = saved.fetch; setMediaStorageForTests(); resetHeifReadinessForTests();
    names.forEach((name, index) => { if (env[index] === undefined) delete process.env[name]; else process.env[name] = env[index]; });
  }
}

test('prepares once, keeps original capability cleanup, and reuses private WebP across crop retries', async () => scenario(async c => {
  const first = await prepareMediaUpload('owner', 'asset');
  assert.equal(first.preview.width, 40); assert.equal(first.preview.height, 30);
  assert.equal(c.asset.status, 'TEMPORARY'); assert.equal(c.asset.sourceMime, 'image/heic');
  assert.equal(c.asset.uploadKey, 'owner/asset/upload.heic');
  assert.equal(c.objects.has(c.asset.uploadKey), false);
  assert.equal((await prepareMediaUpload('owner', 'asset')).id, first.id);
  assert.equal(c.conversions, 1);
  const checksum = c.asset.checksum;
  await finalizeMediaUpload('owner', 'asset', { aspectRatio: 1 });
  await finalizeMediaUpload('owner', 'asset', { aspectRatio: 1.5 });
  assert.equal(c.asset.checksum, checksum); assert.equal(c.asset.sourceMime, 'image/heic');
  assert.equal(c.asset.sourceByteSize, c.source.length);
  assert.ok(c.objects.has('owner/asset/prepared.webp'));
  c.asset.storageCleanupNotBefore = new Date(0);
  await purgeMediaAsset('asset');
  assert.equal(c.objects.size, 0); assert.equal(c.asset.status, 'DELETED');
}));

test('owner and active-account checks run before decoder or storage reads', async () => scenario(async c => {
  await assert.rejects(prepareMediaUpload('stranger', 'asset'), (e: any) => e.code === 'MEDIA_NOT_FOUND');
  c.accountStatus = 'PENDING_DELETION';
  await assert.rejects(prepareMediaUpload('owner', 'asset'), (e: any) => e.code === 'AUTH_REQUIRED');
  assert.equal(c.downloads, 0); assert.equal(c.conversions, 0);
}));

test('deletion during native conversion prevents prepared upload and signed preview', async () => scenario(async c => {
  c.onConvert = () => { c.accountStatus = 'PENDING_DELETION'; };
  await assert.rejects(prepareMediaUpload('owner', 'asset'), (e: any) => e.code === 'AUTH_REQUIRED');
  assert.equal(c.objects.has('owner/asset/prepared.webp'), false); assert.equal(c.signs, 0);
}));

test('cancellation during provider upload cannot revive the asset', async () => scenario(async c => {
  c.onUpload = () => { c.asset.status = 'PENDING_DELETE'; c.asset.errorCode = null; };
  await assert.rejects(prepareMediaUpload('owner', 'asset'), (e: any) => e.code === 'MEDIA_PROCESSING_CANCELLED');
  assert.equal(c.asset.status, 'PENDING_DELETE'); assert.equal(c.asset.checksum, null); assert.equal(c.signs, 0);
  assert.equal(c.objects.has('owner/asset/prepared.webp'), false);
}));

test('ambiguous provider failure retains exact cleanup and requires a fresh preparation asset', async () => scenario(async c => {
  c.onUpload = () => { throw new Error('Ambiguous provider failure'); };
  c.onRemove = () => { throw new Error('Storage temporarily unreachable'); };
  await assert.rejects(prepareMediaUpload('owner', 'asset'));
  assert.equal(c.asset.status, 'FAILED'); assert.ok(c.asset.variants.some((v: any) => v.storageKey === 'owner/asset/prepared.webp'));
  await assert.rejects(prepareMediaUpload('owner', 'asset'), (e: any) => e.code === 'MEDIA_REUPLOAD_REQUIRED');
  assert.equal(c.conversions, 1);
  c.onRemove = undefined; c.asset.storageCleanupNotBefore = new Date(0);
  await purgeMediaAsset('asset'); assert.equal(c.objects.size, 0);
}));

test('corrupt source and excessive cover bytes fail before the converter', async () => scenario(async c => {
  c.objects.set(c.asset.uploadKey, Buffer.alloc(c.source.length));
  await assert.rejects(prepareMediaUpload('owner', 'asset'));
  assert.equal(c.conversions, 0);
  c.asset.status = 'TEMPORARY'; c.asset.purpose = 'PROFILE_COVER';
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1); c.asset.sourceByteSize = oversized.length; c.objects.set(c.asset.uploadKey, oversized);
  await assert.rejects(prepareMediaUpload('owner', 'asset'), (e: any) => e.code === 'INVALID_FILE_SIZE');
  assert.equal(c.conversions, 0);
}));

test('metadata in a converter response is rejected before storage', async () => scenario(async c => {
  c.output = await sharp(c.output).withMetadata().webp().toBuffer();
  await assert.rejects(prepareMediaUpload('owner', 'asset'), (e: any) => e.code === 'HEIF_CONVERSION_FAILED');
  assert.equal(c.asset.variants.length, 0); assert.equal(c.signs, 0);
}));

test('session revocation before preview response returns no signed URL', async () => scenario(async c => {
  let activeSession = true; c.onSign = () => { activeSession = false; };
  await assert.rejects(prepareMediaUpload('owner', 'asset', async () => { if (!activeSession) throw new Error('Session revoked'); }), /Session revoked/);
  assert.equal(c.asset.status, 'TEMPORARY');
}));
