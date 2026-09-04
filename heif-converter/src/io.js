import { ServiceError } from './errors.js';

export async function readFixedBinaryBody(request, maxBodyBytes) {
  if (request.headers['content-type'] !== 'application/octet-stream') {
    throw new ServiceError(415, 'UNSUPPORTED_CONTENT_TYPE', 'Content-Type must be application/octet-stream');
  }
  if (request.headers['transfer-encoding'] !== undefined) {
    throw new ServiceError(400, 'TRANSFER_ENCODING_NOT_ALLOWED', 'Chunked request bodies are not accepted');
  }
  const rawLength = request.headers['content-length'];
  if (typeof rawLength !== 'string' || !/^\d+$/.test(rawLength)) {
    throw new ServiceError(411, 'CONTENT_LENGTH_REQUIRED', 'A valid Content-Length header is required');
  }
  const contentLength = Number.parseInt(rawLength, 10);
  if (contentLength <= 0) throw new ServiceError(400, 'EMPTY_BODY', 'The request body is empty');
  if (!Number.isSafeInteger(contentLength) || contentLength > maxBodyBytes) {
    throw new ServiceError(413, 'BODY_TOO_LARGE', 'The request body exceeds the configured limit');
  }

  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > contentLength || received > maxBodyBytes) {
      throw new ServiceError(400, 'CONTENT_LENGTH_MISMATCH', 'The received body does not match Content-Length');
    }
    chunks.push(chunk);
  }
  if (received !== contentLength) {
    throw new ServiceError(400, 'CONTENT_LENGTH_MISMATCH', 'The received body does not match Content-Length');
  }
  return Buffer.concat(chunks, received);
}

export class AdmissionGate {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
  }

  tryAcquire() {
    if (this.active >= this.limit) return undefined;
    this.active += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active -= 1;
      }
    };
  }
}
