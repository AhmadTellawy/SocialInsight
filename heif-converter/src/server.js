import http from 'node:http';
import { authenticateRequest, ReplayGuard } from './auth.js';
import { inspectHeif } from './bmff.js';
import { ServiceError } from './errors.js';
import { AdmissionGate } from './io.js';
import { readFixedBinaryBody } from './io.js';

const SECURITY_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

function json(response, status, value, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    ...extraHeaders,
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
  });
  response.end(body);
}

export function createConverterServer({ config, converter, healthEvidence, clock = Date, logger = console }) {
  const gate = new AdmissionGate(config.maxConcurrency);
  const replayGuard = new ReplayGuard();

  const server = http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health/live') {
      json(response, 200, { status: 'ok' });
      return;
    }
    if (request.method === 'GET' && request.url === '/health/ready') {
      json(response, 200, healthEvidence);
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/convert') {
      json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
      return;
    }

    const release = gate.tryAcquire();
    if (!release) {
      json(
        response,
        429,
        { error: { code: 'CONVERTER_BUSY', message: 'Converter concurrency limit reached' } },
        { 'retry-after': '1' },
      );
      return;
    }

    let requestId;
    try {
      const body = await readFixedBinaryBody(request, config.maxBodyBytes);
      requestId = authenticateRequest({
        headers: request.headers,
        body,
        secret: config.hmacSecret,
        nowMs: clock.now(),
        windowSeconds: config.signatureWindowSeconds,
        replayGuard,
      });
      inspectHeif(body, { maxAggregatePixels: config.maxAggregatePixels });
      const converted = await converter.convert(body);
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': converted.mime,
        'content-length': converted.data.length,
        'x-image-width': String(converted.width),
        'x-image-height': String(converted.height),
        'x-si-request-id': requestId,
      });
      response.end(converted.data);
    } catch (error) {
      if (!request.readableEnded) request.resume();
      const serviceError = error instanceof ServiceError
        ? error
        : new ServiceError(500, 'INTERNAL_ERROR', 'The conversion request could not be completed');
      if (serviceError.status >= 500) {
        logger.error?.({ event: 'heif_conversion_failed', code: serviceError.code, requestId });
      }
      json(
        response,
        serviceError.status,
        { error: { code: serviceError.code, message: serviceError.message } },
        serviceError.retryAfterSeconds ? { 'retry-after': String(serviceError.retryAfterSeconds) } : {},
      );
    } finally {
      release();
    }
  });

  server.headersTimeout = 10_000;
  server.requestTimeout = 20_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}
