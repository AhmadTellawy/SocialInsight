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
let readinessGeneration = 0;
let readinessSuccessSequence = 0;
let readinessConfiguration: string | undefined;
const readinessRequests = new Map<string, Promise<boolean>>();

const configurationKey = (): string | undefined => isHeifConversionConfigured()
  ? `${configuredUrl()}|${createHash('sha256').update(process.env.HEIF_CONVERTER_SECRET!.trim()).digest('hex')}`
  : undefined;

const synchronizeReadinessConfiguration = (): string | undefined => {
  const configuration = configurationKey();
  if (configuration !== readinessConfiguration) {
    readinessConfiguration = configuration;
    readinessCache = undefined;
    readinessRequests.clear();
    readinessGeneration++;
  }
  return configuration;
};

const abortError = (): DOMException => new DOMException('Image preparation canceled.', 'AbortError');

// Also bound a stalled response body. Fetch's abort alone is not sufficient for
// a custom stream that has already delivered its response headers.
const abortable = <T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(abortError()); };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); }, error => {
      signal.removeEventListener('abort', onAbort); reject(error);
    });
    if (signal.aborted) onAbort();
  });
};

const fetchBounded = (fetchImpl: FetchLike, url: URL, init: RequestInit & { signal: AbortSignal }): Promise<Response> =>
  abortable(fetchImpl(url, init).then(response => {
    if (init.signal.aborted) { discardResponse(response); throw abortError(); }
    return response;
  }), init.signal);

const probeReadiness = async (baseUrl: URL, fetchImpl: FetchLike, timeoutMs: number): Promise<boolean> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchBounded(fetchImpl, new URL('/health/ready', baseUrl), {
      method: 'GET', redirect: 'error', signal: controller.signal
    });
    if (!response.ok) { discardResponse(response); return false; }
    const body = JSON.parse((await readBoundedBody(response, 8 * 1024, controller.signal)).toString('utf8'));
    return body?.status === 'ready'
      && body.service === 'heif-converter'
      && body.protocolVersion === 2
      && body.capabilities?.wholeWorkerIsolation === 'landlock-seccomp-v1'
      && body.capabilities?.supervisor === 'subreaper-v1'
      && body.capabilities?.failurePolicy === 'fail-closed-v1'
      && body.limits?.inputBytes === MEDIA_CONFIG.maxInputBytes
      && body.limits?.outputBytes === MEDIA_CONFIG.maxPreparedOutputBytes
      && body.limits?.maxPixels === MEDIA_CONFIG.maxDecodedPixels
      && body.limits?.wholeWorkerMs === MEDIA_CONFIG.heifWholeWorkerTimeoutMs
      && body.versions?.libheif === '1.23.3'
      && body.versions?.libde265 === '1.1.1'
      && body.versions?.sharp === '0.35.4';
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

export const verifyHeifConversionReadiness = async (
  force = false,
  fetchImpl: FetchLike = fetch,
  options: { warmup?: boolean; signal?: AbortSignal } = {}
): Promise<boolean> => {
  const configuration = synchronizeReadinessConfiguration();
  if (!configuration || options.signal?.aborted) return false;
  if (!force && readinessCache?.configuration === configuration && readinessCache.expiresAt > Date.now()
    && (!options.warmup || readinessCache.ready)) return readinessCache.ready;
  const baseUrl = configuredUrl();
  if (!baseUrl) return false;
  const generation = readinessGeneration;
  // Quick configuration calls never inherit a cold-start wait. Each mode has
  // one shared request; disconnecting a subscriber cannot cancel other users.
  const requestKey = `${generation}:${options.warmup ? 'warmup' : 'quick'}`;
  let request = readinessRequests.get(requestKey);
  if (!request) {
    const successAtStart = readinessSuccessSequence;
    request = probeReadiness(baseUrl, fetchImpl, options.warmup ? MEDIA_CONFIG.heifWarmupTimeoutMs : MEDIA_CONFIG.heifReadinessTimeoutMs).then(ready => {
      if (synchronizeReadinessConfiguration() !== configuration || readinessGeneration !== generation) return false;
      // A probe already pending when another mode verifies readiness cannot
      // revoke that newer success with an old failure or its shorter timeout.
      if (!ready && successAtStart !== readinessSuccessSequence) {
        return Boolean(readinessCache?.ready && readinessCache.expiresAt > Date.now());
      }
      if (!ready && readinessCache?.ready) {
        // This probe began after the current success: its failure is new.
        // Invalidate older pending successes as well as the cached readiness.
        readinessGeneration++;
        readinessRequests.clear();
      }
      if (ready) readinessSuccessSequence++;
      readinessCache = { ready, configuration, expiresAt: Date.now() + (ready ? 60_000 : 10_000) };
      return ready;
    });
    readinessRequests.set(requestKey, request);
    void request.finally(() => { if (readinessRequests.get(requestKey) === request) readinessRequests.delete(requestKey); });
  }
  try { return await abortable(request, options.signal); }
  catch { return false; }
};

export const resetHeifReadinessForTests = (): void => {
  readinessCache = undefined;
  readinessConfiguration = undefined;
  readinessRequests.clear();
  readinessGeneration++;
  readinessSuccessSequence = 0;
};

const discardResponse = (response: Response): void => {
  // Cancellation may itself stall; it must not extend the operation deadline.
  void response.body?.cancel().catch(() => undefined);
};

const readBoundedBody = async (response: Response, maxBytes: number = MEDIA_CONFIG.maxPreparedOutputBytes, signal?: AbortSignal): Promise<Buffer> => {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    discardResponse(response);
    throw new MediaValidationError('HEIF_OUTPUT_TOO_LARGE', 'The converted image exceeds the safe output limit.');
  }
  if (!response.body) throw new MediaValidationError('HEIF_CONVERSION_FAILED', 'The conversion service returned no image.');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new MediaValidationError('HEIF_OUTPUT_TOO_LARGE', 'The converted image exceeds the safe output limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new MediaValidationError('HEIF_CONVERSION_FAILED', 'The conversion service returned an empty image.');
  return Buffer.concat(chunks, total);
};

export class HeifConversionError extends MediaValidationError {
  constructor(code: string, message: string, statusCode: number, public readonly retryAfterSeconds?: number) {
    super(code, message, statusCode);
  }
}

const retryDelayFor = (response: Response): { delayMs: number | null; retryAfterSeconds?: number } => {
  const retryAfter = response.headers.get('retry-after')?.trim();
  let delayMs = 1_000;
  if (retryAfter) {
    const requested = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1_000 : Date.parse(retryAfter) - Date.now();
    // A longer Retry-After is respected by leaving the retry to the caller,
    // rather than retrying earlier than the server requested.
    if (requested > 3_000) return {
      delayMs: null,
      retryAfterSeconds: Number.isFinite(requested) && requested <= 86_400_000 ? Math.ceil(requested / 1000) : undefined
    };
    if (Number.isFinite(requested)) delayMs = Math.max(delayMs, requested);
  }
  return { delayMs, retryAfterSeconds: Math.ceil(delayMs / 1000) };
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
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal
): Promise<Buffer> => {
  const baseUrl = configuredUrl();
  const secret = process.env.HEIF_CONVERTER_SECRET?.trim();
  if (!isHeifConversionConfigured() || !baseUrl || !secret) {
    throw new MediaValidationError('HEIF_CONVERTER_UNAVAILABLE', 'HEIC/HEIF conversion is temporarily unavailable.', 503);
  }
  if (signal?.aborted) throw new MediaValidationError('MEDIA_PROCESSING_CANCELLED', 'Image preparation was cancelled.', 409);
  if (!input.length || input.length > MEDIA_CONFIG.maxInputBytes) {
    throw new MediaValidationError('INVALID_FILE_SIZE', 'The source image exceeds the safe input limit.');
  }
  if (sourceMime !== 'image/heic' && sourceMime !== 'image/heif') {
    throw new MediaValidationError('UNSUPPORTED_MEDIA_TYPE', 'The source image must be HEIC or HEIF.');
  }
  const endpoint = new URL('/v1/convert', baseUrl);
  const bodyHash = createHash('sha256').update(input).digest('hex');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const deadline = Date.now() + MEDIA_CONFIG.heifConversionTimeoutMs;
  const timeout = setTimeout(() => controller.abort(), MEDIA_CONFIG.heifConversionTimeoutMs);
  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (controller.signal.aborted) throw new DOMException('Conversion canceled.', 'AbortError');
      if (attempt > 0 && deadline - Date.now() < MEDIA_CONFIG.heifWholeWorkerTimeoutMs) break;
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const requestId = randomUUID();
      const signature = `v1=${createHmac('sha256', secret)
        .update(`v1\n${timestamp}\n${requestId}\n${bodyHash}`)
        .digest('hex')}`;
      response = await fetchBounded(fetchImpl, endpoint, {
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
      const { delayMs: retryDelayMs } = retryDelayFor(response);
      discardResponse(response);
      if (retryDelayMs === null || retryDelayMs + MEDIA_CONFIG.heifWholeWorkerTimeoutMs > deadline - Date.now()) break;
      await waitForRetry(controller.signal, retryDelayMs);
    }
    if (!response) throw new Error('converter response unavailable');
    if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0] !== 'image/webp') {
      discardResponse(response);
      if (response.status === 429) throw new HeifConversionError('HEIF_CONVERTER_BUSY', 'Image conversion is busy. Please retry.', 429, retryDelayFor(response).retryAfterSeconds);
      if (response.status >= 500 || [401, 403, 404].includes(response.status)) {
        throw new HeifConversionError('HEIF_CONVERTER_UNAVAILABLE', 'HEIC/HEIF conversion is temporarily unavailable.', 503);
      }
      throw new MediaValidationError('HEIF_CONVERSION_FAILED', 'The HEIC/HEIF image could not be converted.', 422);
    }
    return await readBoundedBody(response, MEDIA_CONFIG.maxPreparedOutputBytes, controller.signal);
  } catch (error) {
    if (signal?.aborted) throw new MediaValidationError('MEDIA_PROCESSING_CANCELLED', 'Image preparation was cancelled.', 409);
    if (!(error instanceof MediaValidationError) || error.code === 'HEIF_CONVERTER_UNAVAILABLE') {
      // A failing service must not remain advertised through a cached success;
      // an older in-flight probe cannot republish it after this failure.
      readinessCache = undefined;
      readinessRequests.clear();
      readinessGeneration++;
    }
    if (error instanceof MediaValidationError) throw error;
    throw new MediaValidationError('HEIF_CONVERTER_UNAVAILABLE', 'HEIC/HEIF conversion is temporarily unavailable.', 503);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
};
