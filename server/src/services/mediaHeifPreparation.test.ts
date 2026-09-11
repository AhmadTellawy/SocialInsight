import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import prisma from '../prisma';
import { prepareMediaUpload, finalizeMediaUpload, purgeMediaAsset, getMediaConfigResponse } from './mediaService';
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
  context.assets = new Map([[context.asset.id, context.asset]]);
  context.addAsset = (id: string, ownerId = 'owner') => {
    const asset = { ...structuredClone(context.asset), id, ownerId, status: 'TEMPORARY', errorCode: null,
      sourceWidth: null, sourceHeight: null, checksum: null, variants: [], uploadKey: `${ownerId}/${id}/upload.heic` };
    context.assets.set(id, asset); context.objects.set(asset.uploadKey, source); return asset;
  };
  const matches = (where: any) => {
    const a = context.assets.get(where.id || context.asset.id);
    if (!a) return false;
    return (!where.id || where.id === a.id) && (!where.ownerId || where.ownerId === a.ownerId)
      && (where.deletedAt === undefined || where.deletedAt === a.deletedAt)
      && (!where.errorCode || where.errorCode === a.errorCode)
      && (!where.updatedAt || +where.updatedAt === +a.updatedAt)
      && (!where.status || (typeof where.status === 'string' ? where.status === a.status : where.status.in.includes(a.status)))
      && (!where.owner || where.owner.status === context.accountStatus);
  };
  const update = ({ where, data }: any) => { const asset = context.assets.get(where?.id || context.asset.id); Object.assign(asset, data); asset.updatedAt = new Date(); return structuredClone(asset); };
  const updateMany = async ({ where, data }: any) => { if (!matches(where)) return { count: 0 }; if (data.status === 'PROCESSING') await context.onLease?.(); update({ where, data }); return { count: 1 }; };
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
    mediaAsset: { findUnique: async ({ where }: any) => structuredClone(context.assets.get(where.id) || null), updateMany, update: async (args: any) => update(args) },
    mediaVariant: {
      create: async ({ data }: any) => { const asset = context.assets.get(data.mediaAssetId); asset.variants.push({ id: `variant-${asset.variants.length}`, ...data }); return data; },
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
    globalThis.fetch = async (url: any, init?: RequestInit) => {
      if (String(url).endsWith('/health/ready')) return Response.json({
        status: 'ready', service: 'heif-converter', protocolVersion: 2,
        capabilities: { wholeWorkerIsolation: 'landlock-seccomp-v1', supervisor: 'subreaper-v1', failurePolicy: 'fail-closed-v1' },
        limits: { inputBytes: 15728640, outputBytes: 12582912, maxPixels: 40000000, wholeWorkerMs: 45000 },
        versions: { libheif: '1.23.3', libde265: '1.1.1', sharp: '0.35.4' }
      });
      context.conversions++; context.conversionSignal = init?.signal; await context.onConvert?.();
      return context.response || new Response(context.output, { headers: { 'content-type': 'image/webp' } });
    };
    setMediaStorageForTests({
      createSignedUpload: async () => { throw new Error('unused'); },
      download: async (_bucket, key) => { context.downloads++; await context.onDownload?.(key); const data = context.objects.get(key); if (!data) throw new Error('Missing object'); return data; },
      upload: async (bucket, key, body) => {
        assert.notEqual(bucket, 'media-public');
        assert.ok([...context.assets.values()].some((asset: any) => asset.variants.some((v: any) => v.storageKey === key)), 'Object registered before upload');
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

test('cold HEIF configuration preserves normal image formats and distinguishes configured from ready', async () => scenario(async () => {
  globalThis.fetch = async () => new Response('', { status: 503 });
  const cold = await getMediaConfigResponse();
  assert.equal(cold.heifServerPreparationEnabled, false);
  assert.equal(cold.heifServerPreparationConfigured, true);
  assert.deepEqual(cold.allowedMimeTypes, ['image/jpeg', 'image/png', 'image/webp']);
  process.env.MEDIA_HEIF_SERVER_ENABLED = 'false';
  const disabled = await getMediaConfigResponse();
  assert.equal(disabled.heifServerPreparationConfigured, false);
  assert.deepEqual(disabled.allowedMimeTypes, cold.allowedMimeTypes);
}));

test('verified V2 configuration advertises HEIF alongside normal image formats', async () => scenario(async () => {
  const ready = await getMediaConfigResponse();
  assert.equal(ready.heifServerPreparationEnabled, true);
  assert.equal(ready.heifServerPreparationConfigured, true);
  assert.deepEqual(ready.allowedMimeTypes, ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
}));

test('cancellation before preparation has no database, storage, or conversion effects', async () => scenario(async c => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareMediaUpload('owner', 'asset', undefined, controller.signal), (e: any) => e.code === 'MEDIA_PROCESSING_CANCELLED');
  assert.equal(c.locks, 0); assert.equal(c.downloads, 0); assert.equal(c.conversions, 0);
  assert.equal(c.asset.status, 'TEMPORARY'); assert.equal(c.asset.errorCode, null);
}));

test('request cancellation during source download prevents decoder admission', async () => scenario(async c => {
  const controller = new AbortController(); c.onDownload = () => controller.abort();
  await assert.rejects(prepareMediaUpload('owner', 'asset', undefined, controller.signal), (e: any) => e.code === 'MEDIA_PROCESSING_CANCELLED');
  assert.equal(c.conversions, 0); assert.equal(c.signs, 0); assert.equal(c.asset.status, 'FAILED');
  assert.equal(c.asset.errorCode, 'MEDIA_PROCESSING_CANCELLED');
  assert.equal(c.objects.has(c.asset.uploadKey), true);
}));

test('request cancellation aborts the remote conversion and prevents storage publication', async () => scenario(async c => {
  const controller = new AbortController(); c.onConvert = () => controller.abort();
  await assert.rejects(prepareMediaUpload('owner', 'asset', undefined, controller.signal), (e: any) => e.code === 'MEDIA_PROCESSING_CANCELLED');
  assert.equal(c.conversionSignal.aborted, true); assert.equal(c.asset.status, 'FAILED');
  assert.equal(c.objects.has('owner/asset/prepared.webp'), false); assert.equal(c.signs, 0);
}));

test('request cancellation during storage upload cleans output and retains the exact cleanup ledger', async () => scenario(async c => {
  const controller = new AbortController(); c.onUpload = () => controller.abort();
  await assert.rejects(prepareMediaUpload('owner', 'asset', undefined, controller.signal), (e: any) => e.code === 'MEDIA_PROCESSING_CANCELLED');
  assert.equal(c.objects.has('owner/asset/prepared.webp'), false); assert.equal(c.signs, 0);
  assert.equal(c.asset.status, 'FAILED'); assert.equal(c.asset.checksum, null);
  assert.ok(c.asset.variants.some((v: any) => v.storageKey === 'owner/asset/prepared.webp'));
  assert.equal(c.asset.uploadKey, 'owner/asset/upload.heic');
}));

test('cancellation during signed preview generation never returns its URL', async () => scenario(async c => {
  await prepareMediaUpload('owner', 'asset');
  const controller = new AbortController(); c.onSign = () => controller.abort();
  await assert.rejects(prepareMediaUpload('owner', 'asset', undefined, controller.signal), (e: any) => e.code === 'MEDIA_PROCESSING_CANCELLED');
  assert.equal(c.conversions, 1); assert.equal(c.asset.status, 'TEMPORARY');
}));

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const busy = (error: any) => error.code === 'HEIF_CONVERTER_BUSY' && error.statusCode === 429 && error.retryAfterSeconds === 1;

test('one blocked HEIF download rejects distinct owned assets across accounts before leases or further reads', async () => scenario(async c => {
  const entered = deferred(), held = deferred();
  const second = c.addAsset('second'), other = c.addAsset('other', 'other-owner');
  c.onDownload = async () => { entered.resolve(); await held.promise; };
  const first = prepareMediaUpload('owner', 'asset');
  try {
    await entered.promise;
    await assert.rejects(prepareMediaUpload('owner', 'other'), (e: any) => e.code === 'MEDIA_NOT_FOUND');
    // Resolve blocked test I/O before asserting so the pre-fix failure cannot leave orphaned work.
    const attempts = [prepareMediaUpload('owner', 'second'), prepareMediaUpload('other-owner', 'other')]
      .map(attempt => attempt.then(value => ({ value }), error => ({ error })));
    await flush();
    const downloadedWhileBusy = c.downloads;
    const statesWhileBusy = [second, other].map(asset => ({ status: asset.status, errorCode: asset.errorCode }));
    held.resolve(); await first;
    const results = await Promise.all(attempts);
    assert.equal(downloadedWhileBusy, 1, 'busy attempts must never download another source');
    assert.deepEqual(statesWhileBusy, [{ status: 'TEMPORARY', errorCode: null }, { status: 'TEMPORARY', errorCode: null }]);
    assert.ok(results.every(result => 'error' in result && busy(result.error)));
    assert.equal(c.conversions, 1);
    c.onDownload = undefined;
    await prepareMediaUpload('owner', 'second');
    assert.equal(c.conversions, 2, 'slot releases after successful preparation');
  } finally { held.resolve(); await first.catch(() => undefined); }
}));

test('cancelled preparation keeps admission while its source download remains pending, then recovers', async () => scenario(async c => {
  const entered = deferred(), held = deferred(), controller = new AbortController();
  c.addAsset('next'); c.onDownload = async () => { entered.resolve(); await held.promise; };
  const first = prepareMediaUpload('owner', 'asset', undefined, controller.signal);
  const rejected = assert.rejects(first, (error: any) => error.code === 'MEDIA_PROCESSING_CANCELLED');
  try {
    await entered.promise; controller.abort(); await rejected;
    await assert.rejects(prepareMediaUpload('owner', 'next'), busy);
    assert.equal(c.downloads, 1); assert.equal(c.conversions, 0);
    assert.equal(c.assets.get('next').status, 'TEMPORARY');
    held.resolve(); await flush(); c.onDownload = undefined;
    await prepareMediaUpload('owner', 'next'); assert.equal(c.conversions, 1);
  } finally { held.resolve(); await first.catch(() => undefined); await flush(); }
}));

test('source timeout keeps admission until the actual provider download settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try { await scenario(async c => {
    const entered = deferred(), held = deferred(); c.addAsset('next');
    c.onDownload = async () => { entered.resolve(); await held.promise; };
    const first = prepareMediaUpload('owner', 'asset');
    const rejected = assert.rejects(first, (error: any) => error.code === 'MEDIA_OPERATION_TIMEOUT');
    try {
      await entered.promise; t.mock.timers.tick(60_000); await rejected;
      await assert.rejects(prepareMediaUpload('owner', 'next'), busy);
      assert.equal(c.downloads, 1); assert.equal(c.conversions, 0);
      held.resolve(); await flush(); c.onDownload = undefined;
      await prepareMediaUpload('owner', 'next'); assert.equal(c.conversions, 1);
    } finally { held.resolve(); await first.catch(() => undefined); await flush(); }
  }); } finally { t.mock.timers.reset(); }
});

test('upload timeout holds admission through late provider settlement and its pending cleanup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try { await scenario(async c => {
    const entered = deferred(), held = deferred(), cleanupEntered = deferred(), cleanupHeld = deferred(); c.addAsset('next');
    c.onUpload = async () => { entered.resolve(); await held.promise; };
    const first = prepareMediaUpload('owner', 'asset');
    const rejected = assert.rejects(first, (error: any) => error.code === 'MEDIA_OPERATION_TIMEOUT');
    try {
      await entered.promise; t.mock.timers.tick(60_000); await rejected;
      await assert.rejects(prepareMediaUpload('owner', 'next'), busy);
      c.onRemove = async () => { cleanupEntered.resolve(); await cleanupHeld.promise; };
      held.resolve(); await cleanupEntered.promise;
      await assert.rejects(prepareMediaUpload('owner', 'next'), busy);
      assert.equal(c.downloads, 1); assert.equal(c.conversions, 1);
      assert.ok(c.asset.variants.some((variant: any) => variant.storageKey === 'owner/asset/prepared.webp'));
      cleanupHeld.resolve(); await flush(); c.onRemove = undefined; c.onUpload = undefined;
      await prepareMediaUpload('owner', 'next'); assert.equal(c.conversions, 2);
    } finally { held.resolve(); cleanupHeld.resolve(); await first.catch(() => undefined); await flush(); }
  }); } finally { t.mock.timers.reset(); }
});

test('cancelled conversion retains admission through late fetch and response-body cancellation settlement', async () => scenario(async c => {
  const entered = deferred(), held = deferred(), cleanupEntered = deferred(), cleanupHeld = deferred(), controller = new AbortController();
  c.addAsset('next'); c.onConvert = async () => { entered.resolve(); await held.promise; };
  const first = prepareMediaUpload('owner', 'asset', undefined, controller.signal);
  const rejected = assert.rejects(first, (error: any) => error.code === 'MEDIA_PROCESSING_CANCELLED');
  try {
    await entered.promise; controller.abort(); await rejected;
    await assert.rejects(prepareMediaUpload('owner', 'next'), busy);
    c.response = new Response(new ReadableStream({ cancel() { cleanupEntered.resolve(); return cleanupHeld.promise; } }), { headers: { 'content-type': 'image/webp' } });
    held.resolve(); await cleanupEntered.promise;
    await assert.rejects(prepareMediaUpload('owner', 'next'), busy);
    assert.equal(c.downloads, 1); assert.equal(c.conversions, 1);
    cleanupHeld.resolve(); await flush(); c.onConvert = undefined; c.response = undefined;
    await prepareMediaUpload('owner', 'next'); assert.equal(c.conversions, 2);
  } finally { held.resolve(); cleanupHeld.resolve(); await first.catch(() => undefined); await flush(); }
}));

test('failed lease and rejected storage release admission without poisoning a different asset', async () => scenario(async c => {
  c.addAsset('next'); c.onLease = () => { throw new Error('Synthetic transaction failure'); };
  await assert.rejects(prepareMediaUpload('owner', 'asset'), /Synthetic transaction failure/);
  assert.equal(c.asset.status, 'TEMPORARY'); assert.equal(c.downloads, 0);
  c.onLease = undefined; c.onDownload = () => { throw new Error('Synthetic storage rejection'); };
  await assert.rejects(prepareMediaUpload('owner', 'asset'), /Synthetic storage rejection/);
  assert.equal(c.asset.status, 'FAILED'); assert.equal(c.assets.get('next').status, 'TEMPORARY');
  c.onDownload = undefined;
  await prepareMediaUpload('owner', 'next'); assert.equal(c.conversions, 1);
}));
