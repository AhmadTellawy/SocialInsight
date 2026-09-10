import { createHash, createHmac, randomUUID } from 'crypto';
import { MEDIA_CONFIG } from '../config/media';
import { MediaValidationError } from './mediaProcessor';

type FetchLike = typeof fetch;

const configuredUrl = (): URL | null => {
  const raw = process.env.HEIF_CONVERTER_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.includes('?') || url.href.includes('#')) return null;
    const privateHttpHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || (url.hostname.length > '.internal'.length && url.hostname.endsWith('.internal'));
    if (url.protocol === 'http:' && !privateHttpHost) return null;
    return url;
  } catch {
    return null;
  }
};

export const isHeifConversionConfigured = (): boolean =>
  process.env.MEDIA_HEIF_SERVER_ENABLED === 'true'
  && Boolean(configuredUrl())
  && Buffer.byteLength(process.env.HEIF_CONVERTER_SECRET?.trim() || '', 'utf8') >= 32;

let readinessCache: { ready: boolean; expiresAt: number; configuration: string } | undefined;

export const verifyHeifConversionReadiness = async (
  force = false,
  fetchImpl: FetchLike = fetch
): Promise<boolean> => {
  if (!isHeifConversionConfigured()) return false;
  const configuration = `${configuredUrl()}|${createHash('sha256').update(process.env.HEIF_CONVERTER_SECRET || '').digest('hex')}`;
  if (!force && readinessCache?.configuration === configuration && readinessCache.expiresAt > Date.now()) return readinessCache.ready;
  const baseUrl = configuredUrl();
  if (!baseUrl) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  let ready = false;
  try {
    const response = await fetchImpl(new URL('/health/ready', baseUrl), {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal
    });
    if (response.ok) {
      const body = JSON.parse((await readBoundedBody(response, 8 * 1024)).toString('utf8')) as {
        status?: unknown;
        service?: unknown;
        versions?: { libheif?: unknown; libde265?: unknown; sharp?: unknown };
      };
      ready = body.status === 'ready'
        && body.service === 'heif-converter'
        && body.versions?.libheif === '1.23.3'
        && body.versions?.libde265 === '1.1.1'
        && body.versions?.sharp === '0.35.4';
    } else {
      await discardResponse(response);
    }
  } catch {
    ready = false;
  } finally {
    clearTimeout(timeout);
  }
  readinessCache = {
    ready,
    configuration,
    expiresAt: Date.now() + (ready ? 60_000 : 10_000)
  };
  return ready;
};

export const resetHeifReadinessForTests = (): void => {
  readinessCache = undefined;
};

const discardResponse = async (response: Response): Promise<void> => {
  try { await response.body?.cancel(); }
  catch { /* Preserve the original HTTP failure if the stream is already aborted. */ }
};

const readBoundedBody = async (response: Response, maxBytes = MEDIA_CONFIG.maxPreparedOutputBytes): Promise<Buffer> => {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    await discardResponse(response);
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
      if (total > maxBytes) {
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

const retryDelayFor = (response: Response): number | null => {
  const retryAfter = response.headers.get('retry-after')?.trim();
  let delayMs = 1_000;
  if (retryAfter) {
    const requested = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1_000 : Date.parse(retryAfter) - Date.now();
    // A longer Retry-After is respected by leaving the retry to the caller,
    // rather than retrying earlier than the server requested.
    if (requested > 3_000) return null;
    if (Number.isFinite(requested)) delayMs = Math.max(delayMs, requested);
  }
  return delayMs;
};

const waitForRetry = (signal: AbortSignal, delayMs: number): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new DOMException('Conversion canceled.', 'AbortError')); return; }
  const onAbort = () => {
    clearTimeout(delay);
    reject(new DOMException('Conversion canceled.', 'AbortError'));
  };
  const delay = setTimeout(() => {
    signal.removeEventListener('abort', onAbort);
    resolve();
  }, delayMs);
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
  const deadline = Date.now() + MEDIA_CONFIG.heifConversionTimeoutMs;
  const timeout = setTimeout(() => controller.abort(), MEDIA_CONFIG.heifConversionTimeoutMs);
  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (controller.signal.aborted) throw new DOMException('Conversion canceled.', 'AbortError');
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const requestId = randomUUID();
      const signature = `v1=${createHmac('sha256', secret)
        .update(`v1\n${timestamp}\n${requestId}\n${bodyHash}`)
        .digest('hex')}`;
      response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(input.length),
          'x-si-timestamp': timestamp,
          'x-si-request-id': requestId,
          'x-si-body-sha256': bodyHash,
          'x-si-signature': signature
        },
        body: Uint8Array.from(input).buffer,
        signal: controller.signal
      });
      if (response.status !== 429 || attempt === 1) break;
      const retryDelayMs = retryDelayFor(response);
      await discardResponse(response);
      if (retryDelayMs === null || retryDelayMs >= deadline - Date.now()) break;
      await waitForRetry(controller.signal, retryDelayMs);
    }
    if (!response) throw new Error('converter response unavailable');
    if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0] !== 'image/webp') {
      await discardResponse(response);
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
