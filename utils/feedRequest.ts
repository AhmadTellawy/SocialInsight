const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set(['NETWORK_ERROR', 'REQUEST_TIMEOUT']);

type RequestErrorLike = {
  name?: unknown;
  status?: unknown;
  code?: unknown;
};

export const isAbortError = (error: unknown): boolean => {
  return !!error
    && typeof error === 'object'
    && (error as RequestErrorLike).name === 'AbortError';
};

export const shouldRetryFeedRequest = (error: unknown): boolean => {
  if (!error || typeof error !== 'object' || isAbortError(error)) return false;

  const candidate = error as RequestErrorLike;
  const code = typeof candidate.code === 'string' ? candidate.code : undefined;
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;

  if (code === 'INVALID_FEED_RESPONSE') return false;
  if (code && TRANSIENT_ERROR_CODES.has(code)) return true;
  return status !== undefined && TRANSIENT_HTTP_STATUSES.has(status);
};

export const getFeedRetryDelayMs = (failedAttemptIndex: number): number => {
  return Math.min(750 * (2 ** Math.max(0, failedAttemptIndex)), 1_500);
};

const createAbortError = (): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The request was aborted.', 'AbortError');
  }
  const error = new Error('The request was aborted.');
  error.name = 'AbortError';
  return error;
};

export const waitForAbortableDelay = (delayMs: number, signal: AbortSignal): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const handleAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, delayMs);

    signal.addEventListener('abort', handleAbort, { once: true });
  });
};
