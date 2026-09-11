/// <reference path="../middleware/authMiddleware.ts" />

import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import express from 'express';
import { HeifConversionError } from '../services/heifConversionClient';
import { getMediaConfig, prepareMedia, warmupHeif } from './mediaController';

const mediaService = require('../services/mediaService') as typeof import('../services/mediaService');
const heifClient = require('../services/heifConversionClient') as typeof import('../services/heifConversionClient');

const requestResponse = () => {
  const request: any = Object.assign(new EventEmitter(), { user: { userId: 'synthetic-owner' }, params: { id: 'synthetic-asset' }, aborted: false });
  const response: any = Object.assign(new EventEmitter(), {
    headers: {} as Record<string, string>, statusCode: 200, bodies: [] as unknown[], writableEnded: false, destroyed: false,
    setHeader(name: string, value: string) { response.headers[name] = value; return response; },
    status(value: number) { response.statusCode = value; return response; },
    json(body: unknown) { response.bodies.push(body); response.writableEnded = true; return response; }
  });
  return { request, response };
};

test('warmup returns only the readiness flag and private no-store caching', async t => {
  const { request, response } = requestResponse();
  t.mock.method(heifClient, 'verifyHeifConversionReadiness', async (...[force, _fetch, options]: Parameters<typeof heifClient.verifyHeifConversionReadiness>) => {
    assert.equal(force, false); assert.equal(options?.warmup, true);
    assert.ok(options?.signal instanceof AbortSignal);
    return true;
  });
  await warmupHeif(request, response);
  assert.deepEqual(response.bodies, [{ heifServerPreparationEnabled: true }]);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.equal(request.listenerCount('aborted'), 0); assert.equal(response.listenerCount('close'), 0);
});

test('warmup ignores normal request close and cancels only a disconnected response', async t => {
  const { request, response } = requestResponse();
  let signal!: AbortSignal, release!: (value: boolean) => void;
  t.mock.method(heifClient, 'verifyHeifConversionReadiness', async (...[_force, _fetch, options]: Parameters<typeof heifClient.verifyHeifConversionReadiness>) => {
    signal = options!.signal!; return new Promise<boolean>(resolve => { release = resolve; });
  });
  const pending = warmupHeif(request, response);
  request.emit('close'); assert.equal(signal.aborted, false);
  response.emit('close'); assert.equal(signal.aborted, true);
  release(false); await pending;
  assert.deepEqual(response.bodies, []);
  assert.equal(request.listenerCount('aborted'), 0); assert.equal(response.listenerCount('close'), 0);
});

test('prepare forwards request abortion to conversion and sends no response afterward', async t => {
  const { request, response } = requestResponse();
  let signal!: AbortSignal, release!: (value: any) => void;
  t.mock.method(mediaService, 'prepareMediaUpload', async (...[ownerId, assetId, authorize, inputSignal]: Parameters<typeof mediaService.prepareMediaUpload>) => {
    assert.equal(ownerId, 'synthetic-owner'); assert.equal(assetId, 'synthetic-asset'); assert.equal(typeof authorize, 'function');
    signal = inputSignal!; return new Promise(resolve => { release = resolve; });
  });
  const pending = prepareMedia(request, response);
  assert.equal(signal.aborted, false); request.emit('aborted'); assert.equal(signal.aborted, true);
  release({ id: 'synthetic-asset' }); await pending;
  assert.deepEqual(response.bodies, []);
  assert.equal(request.listenerCount('aborted'), 0); assert.equal(response.listenerCount('close'), 0);
});

test('prepare returns success and removes disconnect listeners', async t => {
  const { request, response } = requestResponse();
  const prepared = { id: 'synthetic-asset', status: 'TEMPORARY', preview: { width: 40, height: 30 } };
  t.mock.method(mediaService, 'prepareMediaUpload', async () => prepared as any);
  await prepareMedia(request, response);
  assert.deepEqual(response.bodies, [prepared]); assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.equal(request.listenerCount('aborted'), 0); assert.equal(response.listenerCount('close'), 0);
});

test('prepare preserves busy Retry-After and its safe error code', async t => {
  const { request, response } = requestResponse();
  t.mock.method(mediaService, 'prepareMediaUpload', async () => {
    throw new HeifConversionError('HEIF_CONVERTER_BUSY', 'Image conversion is busy. Please retry.', 429, 4);
  });
  await prepareMedia(request, response);
  assert.equal(response.statusCode, 429); assert.equal(response.headers['Retry-After'], '4');
  assert.deepEqual(response.bodies, [{ code: 'HEIF_CONVERTER_BUSY', error: 'Image conversion is busy. Please retry.' }]);
});

test('configuration explicitly prevents caching a temporary HEIF readiness failure', async t => {
  const { request, response } = requestResponse();
  const config = { heifServerPreparationEnabled: false, heifServerPreparationConfigured: true };
  t.mock.method(mediaService, 'getMediaConfigResponse', async () => config as any);
  await getMediaConfig(request, response);
  assert.equal(response.headers['Cache-Control'], 'private, no-store'); assert.deepEqual(response.bodies, [config]);
});

test('the actual warmup route rejects an unauthenticated HTTP request before probing', { timeout: 10000 }, async t => {
  const router = require('../routes/mediaRoutes').default;
  let probes = 0;
  t.mock.method(heifClient, 'verifyHeifConversionReadiness', async () => { probes++; return true; });
  const app = express(); app.use('/api/media', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/media/heif/warmup`, { method: 'POST' });
    assert.equal(response.status, 401); assert.equal((await response.json()).code, 'AUTH_REQUIRED'); assert.equal(probes, 0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('real client disconnection reaches the prepare AbortSignal', { timeout: 10000 }, async t => {
  let arrived!: () => void, disconnected!: () => void;
  const admitted = new Promise<void>(resolve => { arrived = resolve; });
  const canceled = new Promise<void>(resolve => { disconnected = resolve; });
  t.mock.method(mediaService, 'prepareMediaUpload', async (...[_owner, _asset, _authorize, signal]: Parameters<typeof mediaService.prepareMediaUpload>) => {
    arrived();
    return new Promise(resolve => {
      signal!.addEventListener('abort', () => { disconnected(); resolve({ id: 'synthetic-asset' } as any); }, { once: true });
    });
  });
  const app = express();
  app.post('/:id/prepare', (req, res) => { req.user = { userId: 'synthetic-owner' }; void prepareMedia(req, res); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const controller = new AbortController();
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const response = fetch(`http://127.0.0.1:${address.port}/synthetic-asset/prepare`, { method: 'POST', signal: controller.signal });
    const rejected = assert.rejects(response, (error: any) => error.name === 'AbortError');
    await admitted; controller.abort(); await rejected; await canceled;
  } finally { controller.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
