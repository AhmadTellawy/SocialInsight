import { createHash, createHmac, randomUUID } from 'crypto';
import { MEDIA_CONFIG } from '../config/media';
import { MediaValidationError } from './mediaProcessor';

type FetchLike = typeof fetch;

const configuredUrl = (): URL | null => {
  const raw = process.env.HEIF_CONVERTER_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
};

export const isHeifConversionConfigured = (): boolean =>
  process.env.MEDIA_HEIF_SERVER_ENABLED === 'true'
  && Boolean(configuredUrl())
  && Boolean(process.env.HEIF_CONVERTER_SECRET?.trim());

let readinessCache: { ready: boolean; expiresAt: number } | undefined;

export const verifyHeifConversionReadiness = async (
  force = false,
  fetchImpl: FetchLike = fetch
): Promise<boolean> => {
  if (!isHeifConversionConfigured()) return false;
  if (!force && readinessCache && readinessCache.expiresAt > Date.now()) return readinessCache.ready;
  const baseUrl = configuredUrl();
  if (!baseUrl) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  let ready = false;
  try {
    const response = await fetchImpl(new URL('/health/ready', baseUrl), {
      method: 'GET',
      signal: controller.signal
    });
    if (response.ok) {
      const body = await response.json() as {
        status?: unknown;
        service?: unknown;
        versions?: { libheif?: unknown; libde265?: unknown; sharp?: unknown };
      };
      ready = body.status === 'ready'
        && body.service === 'heif-converter'
        && body.versions?.libheif === '1.23.3'
        && body.versions?.libde265 === '1.1.1'
        && body.versions?.sharp === '0.35.4';
    }
  } catch {
    ready = false;
  } finally {
    clearTimeout(timeout);
  }
  readinessCache = {
    ready,
    expiresAt: Date.now() + (ready ? 60_000 : 10_000)
  };
  return ready;
};

export const resetHeifReadinessForTests = (): void => {
  readinessCache = undefined;
};

const readBoundedBody = async (response: Response): Promise<Buffer> => {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MEDIA_CONFIG.maxPreparedOutputBytes) {
    throw new MediaValidationError('HEIF_OUTPUT_TOO_LARGE', 'The converted image exceeds the safe output limit.');
  }
  if (!response.body) throw new MediaValidationError('HEIF_CONVERSION_FAILED', 'The conversion service returned no image.');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MEDIA_CONFIG.maxPreparedOutputBytes) {
        await reader.cancel();
        throw new MediaValidationError('HEIF_OUTPUT_TOO_LARGE', 'The converted image exceeds the safe output limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new MediaValidationError('HEIF_CONVERSION_FAILED', 'The conversion service returned an empty image.');
  return Buffer.concat(chunks, total);
};

const waitForRetry = (signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const onAbort = () => {
    clearTimeout(delay);
    reject(new DOMException('Conversion canceled.', 'AbortError'));
  };
  const delay = setTimeout(() => {
    signal.removeEventListener('abort', onAbort);
    resolve();
  }, 250 + Math.floor(Math.random() * 250));
  signal.addEventListener('abort', onAbort, { once: true });
});

export const convertHeifRemotely = async (
  input: Buffer,
  sourceMime: 'image/heic' | 'image/heif',
  fetchImpl: FetchLike = fetch
): Promise<Buffer> => {
  const baseUrl = configuredUrl();
  const secret = process.env.HEIF_CONVERTER_SECRET?.trim();
  if (!isHeifConversionConfigured() || !baseUrl || !secret) {
    throw new MediaValidationError('HEIF_CONVERTER_UNAVAILABLE', 'HEIC/HEIF conversion is temporarily unavailable.', 503);
  }
  const endpoint = new URL('/v1/convert', baseUrl);
  const bodyHash = createHash('sha256').update(input).digest('hex');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_CONFIG.heifConversionTimeoutMs);
  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const requestId = randomUUID();
      const signature = `v1=${createHmac('sha256', secret)
        .update(`v1\n${timestamp}\n${requestId}\n${bodyHash}`)
        .digest('hex')}`;
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(input.length),
          'x-si-timestamp': timestamp,
          'x-si-request-id': requestId,
          'x-si-signature': signature
        },
        body: Uint8Array.from(input).buffer,
        signal: controller.signal
      });
      if (response.status !== 429 || attempt === 1) break;
      await waitForRetry(controller.signal);
    }
    if (!response) throw new Error('converter response unavailable');
    if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0] !== 'image/webp') {
      throw new MediaValidationError(
        response.status === 429 ? 'HEIF_CONVERTER_BUSY' : 'HEIF_CONVERSION_FAILED',
        response.status === 429 ? 'Image conversion is busy. Please retry.' : 'The HEIC/HEIF image could not be converted.',
        response.status === 429 ? 429 : 422
      );
    }
    return await readBoundedBody(response);
  } catch (error) {
    if (error instanceof MediaValidationError) throw error;
    throw new MediaValidationError('HEIF_CONVERTER_UNAVAILABLE', 'HEIC/HEIF conversion is temporarily unavailable.', 503);
  } finally {
    clearTimeout(timeout);
  }
};
