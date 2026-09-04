import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import prisma from '../prisma';
import { resetHeifReadinessForTests } from './heifConversionClient';
import { cleanupExpiredMedia, prepareMediaUpload } from './mediaService';
import { MediaStorage, setMediaStorageForTests } from './mediaStorage';

const originalFetch = globalThis.fetch;
const originalEnv = {
  enabled: process.env.MEDIA_HEIF_SERVER_ENABLED,
  url: process.env.HEIF_CONVERTER_URL,
  secret: process.env.HEIF_CONVERTER_SECRET,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEnv.enabled === undefined) delete process.env.MEDIA_HEIF_SERVER_ENABLED;
  else process.env.MEDIA_HEIF_SERVER_ENABLED = originalEnv.enabled;
  if (originalEnv.url === undefined) delete process.env.HEIF_CONVERTER_URL;
  else process.env.HEIF_CONVERTER_URL = originalEnv.url;
  if (originalEnv.secret === undefined) delete process.env.HEIF_CONVERTER_SECRET;
  else process.env.HEIF_CONVERTER_SECRET = originalEnv.secret;
  if (originalEnv.supabaseUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalEnv.supabaseUrl;
  if (originalEnv.supabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.supabaseKey;
  resetHeifReadinessForTests();
  setMediaStorageForTests();
});

const heifFixture = (): Buffer => {
  const bytes = Buffer.alloc(57);
  bytes.writeUInt32BE(20, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write('heic', 8, 'ascii');
  bytes.write('heic', 16, 'ascii');
  bytes.writeUInt32BE(8, 20);
  bytes.write('hvcC', 24, 'ascii');
  bytes.writeUInt32BE(20, 28);
  bytes.write('ispe', 32, 'ascii');
  bytes.writeUInt32BE(1200, 40);
  bytes.writeUInt32BE(800, 44);
  bytes.writeUInt32BE(9, 48);
  bytes.write('mdat', 52, 'ascii');
  bytes[56] = 1;
  return bytes;
};

test('prepares a verified HEIC upload once and stores only a private WebP master', async () => {
  process.env.MEDIA_HEIF_SERVER_ENABLED = 'true';
  process.env.HEIF_CONVERTER_URL = 'http://heif-converter:10000';
  process.env.HEIF_CONVERTER_SECRET = 'a-test-secret-with-at-least-32-bytes';
  const source = heifFixture();
  const converted = await sharp({
    create: { width: 1200, height: 800, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } }
  }).webp({ quality: 92, alphaQuality: 100 }).toBuffer();
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/health/ready')) {
      return Response.json({
        status: 'ready',
        service: 'heif-converter',
        versions: { libheif: '1.23.3', libde265: '1.1.1', sharp: '0.35.4' }
      });
    }
    return new Response(Uint8Array.from(converted).buffer, { status: 200, headers: { 'content-type': 'image/webp' } });
  }) as typeof fetch;

  const asset: any = {
    id: 'asset-1', ownerId: 'owner-1', purpose: 'PROFILE_AVATAR', status: 'TEMPORARY',
    accessScope: 'OWNER_ONLY', sourceMime: 'image/heic', sourceByteSize: source.length,
    uploadBucket: 'media-originals', uploadKey: 'owner-1/asset-1/upload.heic',
    deletedAt: null, variants: [], altText: null
  };
  const originalFindUnique = prisma.mediaAsset.findUnique;
  const originalUpdateMany = prisma.mediaAsset.updateMany;
  const originalTransaction = prisma.$transaction;
  const uploaded: Array<{ bucket: string; key: string; mime: string }> = [];
  const storage: MediaStorage = {
    createSignedUpload: async () => { throw new Error('not used'); },
    download: async (_bucket, key) => key.endsWith('upload.heic') ? source : converted,
    upload: async (bucket, key, _body, mime) => { uploaded.push({ bucket, key, mime }); },
    copy: async () => undefined,
    remove: async () => undefined,
    createSignedReadUrl: async () => 'https://media.invalid/prepared',
    getPublicUrl: () => 'https://media.invalid/public',
    provisionBuckets: async () => undefined
  };
  setMediaStorageForTests(storage);
  (prisma.mediaAsset as any).findUnique = async () => asset;
  (prisma.mediaAsset as any).updateMany = async ({ where, data }: any) => {
    const allowed = typeof where.status === 'string' ? [where.status] : where.status?.in;
    if (allowed && !allowed.includes(asset.status)) return { count: 0 };
    Object.assign(asset, data);
    return { count: 1 };
  };
  (prisma as any).$transaction = async (callback: any) => callback({
    mediaAsset: {
      updateMany: (prisma.mediaAsset as any).updateMany
    },
    mediaVariant: {
      deleteMany: async () => ({ count: asset.variants.length }),
      create: async ({ data }: any) => {
        const variant = { id: 'variant-1', createdAt: new Date(), ...data };
        asset.variants = [variant];
        return variant;
      }
    }
  });

  try {
    const prepared = await prepareMediaUpload('owner-1', 'asset-1');
    assert.equal(prepared.status, 'TEMPORARY');
    assert.equal(prepared.preview.mime, 'image/webp');
    assert.equal(prepared.preview.src, 'https://media.invalid/prepared');
    assert.equal(asset.sourceMime, 'image/heic');
    assert.match(asset.checksum, /^[a-f0-9]{64}$/);
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].bucket, 'media-originals');
    assert.match(uploaded[0].key, /^owner-1\/asset-1\/prepared-[0-9a-f-]{36}\.webp$/);
    assert.equal(uploaded[0].mime, 'image/webp');

    const idempotent = await prepareMediaUpload('owner-1', 'asset-1');
    assert.equal(idempotent.preview.src, 'https://media.invalid/prepared');
    assert.equal(uploaded.length, 1);
  } finally {
    (prisma.mediaAsset as any).findUnique = originalFindUnique;
    (prisma.mediaAsset as any).updateMany = originalUpdateMany;
    (prisma as any).$transaction = originalTransaction;
  }
});

test('a recovered HEIF attempt cannot delete the newer attempt output when it finishes late', async () => {
  process.env.MEDIA_HEIF_SERVER_ENABLED = 'true';
  process.env.HEIF_CONVERTER_URL = 'http://heif-converter:10000';
  process.env.HEIF_CONVERTER_SECRET = 'a-test-secret-with-at-least-32-bytes';
  const source = heifFixture();
  const converted = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 4, g: 5, b: 6 } }
  }).webp().toBuffer();
  let releaseFirst!: () => void;
  let firstConversionStarted!: () => void;
  const firstConversion = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise<void>((resolve) => { firstConversionStarted = resolve; });
  let conversions = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input).endsWith('/health/ready')) {
      return Response.json({
        status: 'ready', service: 'heif-converter',
        versions: { libheif: '1.23.3', libde265: '1.1.1', sharp: '0.35.4' }
      });
    }
    conversions += 1;
    if (conversions === 1) {
      firstConversionStarted();
      await firstConversion;
    }
    return new Response(Uint8Array.from(converted).buffer, {
      status: 200,
      headers: { 'content-type': 'image/webp' }
    });
  }) as typeof fetch;

  const asset: any = {
    id: 'asset-race', ownerId: 'owner-race', purpose: 'PROFILE_AVATAR', status: 'TEMPORARY',
    accessScope: 'OWNER_ONLY', sourceMime: 'image/heic', sourceByteSize: source.length,
    uploadBucket: 'media-originals', uploadKey: 'owner-race/asset-race/upload.heic',
    deletedAt: null, variants: [], altText: null, errorCode: null
  };
  const originalFindUnique = prisma.mediaAsset.findUnique;
  const originalUpdateMany = prisma.mediaAsset.updateMany;
  const originalTransaction = prisma.$transaction;
  const stored = new Set<string>();
  const removed: string[] = [];
  setMediaStorageForTests({
    createSignedUpload: async () => { throw new Error('not used'); },
    download: async () => source,
    upload: async (_bucket, key) => { stored.add(key); },
    copy: async () => undefined,
    remove: async (_bucket, keys) => { keys.forEach((key) => { removed.push(key); stored.delete(key); }); },
    createSignedReadUrl: async (_bucket, key) => `https://media.invalid/${key}`,
    getPublicUrl: () => '',
    provisionBuckets: async () => undefined
  });
  (prisma.mediaAsset as any).findUnique = async () => asset;
  (prisma.mediaAsset as any).updateMany = async ({ where, data }: any) => {
    const statuses = typeof where.status === 'string' ? [where.status] : where.status?.in;
    if (statuses && !statuses.includes(asset.status)) return { count: 0 };
    if (Object.prototype.hasOwnProperty.call(where, 'errorCode') && where.errorCode !== asset.errorCode) return { count: 0 };
    Object.assign(asset, data);
    return { count: 1 };
  };
  (prisma as any).$transaction = async (callback: any) => callback({
    mediaAsset: { updateMany: (prisma.mediaAsset as any).updateMany },
    mediaVariant: {
      deleteMany: async () => ({ count: asset.variants.length }),
      create: async ({ data }: any) => {
        const variant = { id: `variant-${asset.variants.length + 1}`, createdAt: new Date(), ...data };
        asset.variants = [variant];
        return variant;
      }
    }
  });

  try {
    const oldAttempt = prepareMediaUpload('owner-race', 'asset-race');
    await firstStarted;
    const oldLease = asset.errorCode;
    asset.status = 'FAILED';
    asset.errorCode = 'MEDIA_PROCESSING_INTERRUPTED';

    const newer = await prepareMediaUpload('owner-race', 'asset-race');
    const newerKey = asset.variants[0].storageKey as string;
    assert.match(newerKey, /prepared-[0-9a-f-]{36}\.webp$/);
    assert.ok(stored.has(newerKey));
    assert.notEqual(asset.errorCode, oldLease);

    releaseFirst();
    await assert.rejects(oldAttempt, (error: unknown) => (
      error instanceof Error && 'code' in error && error.code === 'MEDIA_STATE_CONFLICT'
    ));
    assert.equal(newer.id, 'asset-race');
    assert.ok(stored.has(newerKey));
    assert.equal(asset.variants[0].storageKey, newerKey);
    assert.equal(removed.includes(newerKey), false);
  } finally {
    (prisma.mediaAsset as any).findUnique = originalFindUnique;
    (prisma.mediaAsset as any).updateMany = originalUpdateMany;
    (prisma as any).$transaction = originalTransaction;
  }
});

test('an ambiguous prepared upload is removed before the processing lease becomes retryable', async () => {
  process.env.MEDIA_HEIF_SERVER_ENABLED = 'true';
  process.env.HEIF_CONVERTER_URL = 'http://heif-converter:10000';
  process.env.HEIF_CONVERTER_SECRET = 'a-test-secret-with-at-least-32-bytes';
  const source = heifFixture();
  const converted = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 7, g: 8, b: 9 } }
  }).webp().toBuffer();
  globalThis.fetch = (async (input: string | URL | Request) => (
    String(input).endsWith('/health/ready')
      ? Response.json({
          status: 'ready', service: 'heif-converter',
          versions: { libheif: '1.23.3', libde265: '1.1.1', sharp: '0.35.4' }
        })
      : new Response(Uint8Array.from(converted).buffer, {
          status: 200,
          headers: { 'content-type': 'image/webp' }
        })
  )) as typeof fetch;
  const asset: any = {
    id: 'asset-ambiguous', ownerId: 'owner-ambiguous', purpose: 'PROFILE_AVATAR', status: 'TEMPORARY',
    sourceMime: 'image/heic', sourceByteSize: source.length, uploadBucket: 'media-originals',
    uploadKey: 'owner-ambiguous/asset-ambiguous/upload.heic', deletedAt: null, variants: [], errorCode: null
  };
  const originalFindUnique = prisma.mediaAsset.findUnique;
  const originalUpdateMany = prisma.mediaAsset.updateMany;
  const removed: string[] = [];
  (prisma.mediaAsset as any).findUnique = async () => asset;
  (prisma.mediaAsset as any).updateMany = async ({ where, data }: any) => {
    const statuses = typeof where.status === 'string' ? [where.status] : where.status?.in;
    if (statuses && !statuses.includes(asset.status)) return { count: 0 };
    if (Object.prototype.hasOwnProperty.call(where, 'errorCode') && where.errorCode !== asset.errorCode) return { count: 0 };
    Object.assign(asset, data);
    return { count: 1 };
  };
  setMediaStorageForTests({
    createSignedUpload: async () => { throw new Error('not used'); },
    download: async () => source,
    upload: async () => { throw new Error('response lost after storage accepted the bytes'); },
    copy: async () => undefined,
    remove: async (_bucket, keys) => { removed.push(...keys); },
    createSignedReadUrl: async () => '',
    getPublicUrl: () => '',
    provisionBuckets: async () => undefined
  });
  try {
    await assert.rejects(prepareMediaUpload('owner-ambiguous', 'asset-ambiguous'));
    assert.equal(asset.status, 'FAILED');
    assert.equal(asset.errorCode, 'HEIF_CONVERSION_FAILED');
    assert.equal(removed.length, 1);
    assert.match(removed[0], /^owner-ambiguous\/asset-ambiguous\/prepared-[0-9a-f-]{36}\.webp$/);
  } finally {
    (prisma.mediaAsset as any).findUnique = originalFindUnique;
    (prisma.mediaAsset as any).updateMany = originalUpdateMany;
  }
});

test('recovers stale processing leases without sharing attempt storage keys', async () => {
  process.env.SUPABASE_URL = 'https://storage.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const originalUpdateMany = prisma.mediaAsset.updateMany;
  const originalFindMany = prisma.mediaAsset.findMany;
  const updates: any[] = [];
  let findCall = 0;
  const removed: string[][] = [];
  setMediaStorageForTests({
    createSignedUpload: async () => { throw new Error('not used'); },
    download: async () => Buffer.alloc(0),
    upload: async () => undefined,
    copy: async () => undefined,
    remove: async (_bucket, keys) => { removed.push(keys); },
    createSignedReadUrl: async () => '',
    getPublicUrl: () => '',
    provisionBuckets: async () => undefined
  });
  (prisma.mediaAsset as any).updateMany = async (args: any) => { updates.push(args); return { count: 1 }; };
  (prisma.mediaAsset as any).findMany = async () => {
    findCall += 1;
    if (findCall === 1) return [{
      id: 'asset-stale', ownerId: 'owner-stale', purpose: 'PROFILE_AVATAR', sourceMime: 'image/heic',
      errorCode: 'MEDIA_PROCESSING:11111111-1111-4111-8111-111111111111'
    }];
    if (findCall === 2) return [{
      id: 'asset-2', ownerId: 'owner-2', sourceMime: 'image/heif',
      uploadBucket: 'media-originals',
      uploadKey: 'owner-2/asset-2/prepared-22222222-2222-4222-8222-222222222222.webp'
    }];
    return [];
  };
  try {
    assert.equal(await cleanupExpiredMedia(), 0);
    assert.equal(updates[0].where.errorCode, 'MEDIA_PROCESSING:11111111-1111-4111-8111-111111111111');
    assert.equal(updates[0].data.errorCode, 'MEDIA_PROCESSING_CLEANUP:11111111-1111-4111-8111-111111111111');
    assert.deepEqual(removed[0], [
      'owner-stale/asset-stale/master-11111111-1111-4111-8111-111111111111.webp',
      'owner-stale/asset-stale/prepared-11111111-1111-4111-8111-111111111111.webp'
    ]);
    assert.deepEqual(removed[1], [
      'owner-stale/asset-stale/private/64-11111111-1111-4111-8111-111111111111.webp',
      'owner-stale/asset-stale/private/128-11111111-1111-4111-8111-111111111111.webp',
      'owner-stale/asset-stale/private/256-11111111-1111-4111-8111-111111111111.webp',
      'owner-stale/asset-stale/private/512-11111111-1111-4111-8111-111111111111.webp'
    ]);
    assert.equal(updates[1].where.errorCode, 'MEDIA_PROCESSING_CLEANUP:11111111-1111-4111-8111-111111111111');
    assert.equal(updates[1].data.status, 'FAILED');
    assert.deepEqual(removed[2], [
      'owner-2/asset-2/prepared-22222222-2222-4222-8222-222222222222.webp',
      'owner-2/asset-2/upload.heif'
    ]);
  } finally {
    (prisma.mediaAsset as any).updateMany = originalUpdateMany;
    (prisma.mediaAsset as any).findMany = originalFindMany;
  }
});
