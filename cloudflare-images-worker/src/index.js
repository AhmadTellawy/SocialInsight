const MAX_INPUT_BYTES = 20_000_000;
const MAX_APP_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 100_000_000;
const MAX_EDGE = 2400;
const TIMESTAMP_SKEW_SECONDS = 120;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SINGLE_IMAGE_BRANDS = new Set(['heic', 'heix', 'mif1']);
const SEQUENCE_BRANDS = new Set(['hevc', 'hevx', 'hevm', 'hevs', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  }
});

const fail = (status, code, message, headers = {}) => json({ error: message, code }, status, {
  'x-si-error-code': code,
  ...headers
});

const readiness = () => ({
  status: 'ready',
  service: 'cloudflare-images-heic-adapter',
  protocolVersion: 3,
  capabilities: {
    provider: 'cloudflare-images-binding',
    auth: 'hmac-sha256-v1',
    sourcePersistence: 'none',
    output: 'image/webp'
  },
  limits: {
    inputBytes: MAX_APP_INPUT_BYTES,
    bindingInputBytes: MAX_INPUT_BYTES,
    outputBytes: MAX_OUTPUT_BYTES,
    maxSourcePixels: MAX_SOURCE_PIXELS,
    maxEdge: MAX_EDGE
  }
});

const bytesToHex = (bytes) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

const sha256 = async (bytes) => bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));

const hmac = async (secret, payload) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
};

const constantTimeEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const ascii = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));

const inspectBrands = (bytes) => {
  if (bytes.byteLength < 24 || ascii(bytes, 4, 4) !== 'ftyp') return { supported: false, code: 'MIME_MISMATCH' };
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (boxSize < 16 || boxSize > Math.min(bytes.byteLength, 4096)) return { supported: false, code: 'INVALID_IMAGE' };
  const brands = new Set([ascii(bytes, 8, 4)]);
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) brands.add(ascii(bytes, offset, 4));
  if ([...brands].some(brand => SEQUENCE_BRANDS.has(brand))) return { supported: false, code: 'UNSUPPORTED_MEDIA_SEQUENCE' };
  if ([...brands].some(brand => AVIF_BRANDS.has(brand))) return { supported: false, code: 'UNSUPPORTED_MEDIA_TYPE' };
  if (![...brands].some(brand => SINGLE_IMAGE_BRANDS.has(brand))) return { supported: false, code: 'UNSUPPORTED_HEIF_VARIANT' };
  return { supported: true };
};

const authenticateHeaders = async (request, secret) => {
  if (!secret || new TextEncoder().encode(secret.trim()).byteLength < 32) return null;
  const timestamp = request.headers.get('x-si-timestamp')?.trim() || '';
  const requestId = request.headers.get('x-si-request-id')?.trim() || '';
  const claimedHash = request.headers.get('x-si-body-sha256')?.trim().toLowerCase() || '';
  const claimedSignature = request.headers.get('x-si-signature')?.trim().toLowerCase() || '';
  if (!/^\d{10}$/.test(timestamp) || !REQUEST_ID_PATTERN.test(requestId)
      || !HEX_SHA256_PATTERN.test(claimedHash) || !/^v1=[0-9a-f]{64}$/.test(claimedSignature)) return null;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > TIMESTAMP_SKEW_SECONDS) return null;
  const expected = `v1=${await hmac(secret.trim(), `v1\n${timestamp}\n${requestId}\n${claimedHash}`)}`;
  return constantTimeEqual(expected, claimedSignature) ? claimedHash : null;
};

const cloudflareErrorCode = (error) => {
  const text = [error?.code, error?.message, error?.cause?.code, error?.cause?.message].filter(Boolean).join(' ');
  const match = text.match(/\b(94\d{2}|95\d{2})\b/);
  return match?.[1];
};

export const handleRequest = async (request, env) => {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') {
    return json(readiness());
  }
  if (request.method === 'GET' && url.pathname === '/health/ready') {
    const secretBytes = new TextEncoder().encode(env.HEIF_CONVERTER_SECRET?.trim() || '').byteLength;
    return secretBytes >= 32
      ? json(readiness())
      : fail(503, 'NOT_READY', 'Image conversion is not configured.');
  }
  if (url.pathname !== '/v1/convert') return fail(404, 'NOT_FOUND', 'Not found.');
  if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.', { allow: 'POST' });
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/octet-stream') {
    return fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'Binary image input is required.');
  }
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (!Number.isInteger(declaredLength) || declaredLength <= 0 || declaredLength > MAX_INPUT_BYTES) {
    return fail(413, 'INVALID_FILE_SIZE', 'The source image exceeds the safe input limit.');
  }
  // Authenticate the signed metadata before buffering an attacker-controlled
  // body. The content hash is then verified after the bounded read.
  const claimedHash = await authenticateHeaders(request, env.HEIF_CONVERTER_SECRET);
  if (!claimedHash) return fail(401, 'UNAUTHORIZED', 'Unauthorized.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength !== declaredLength || bytes.byteLength > MAX_INPUT_BYTES) {
    return fail(413, 'INVALID_FILE_SIZE', 'The source image size is invalid.');
  }
  if (!constantTimeEqual(await sha256(bytes), claimedHash)) {
    return fail(401, 'UNAUTHORIZED', 'Unauthorized.');
  }
  const sourceMime = request.headers.get('x-si-source-mime')?.trim().toLowerCase();
  if (sourceMime !== 'image/heic' && sourceMime !== 'image/heif') {
    return fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'The source image must be HEIC or HEIF.');
  }
  const inspection = inspectBrands(bytes);
  if (!inspection.supported) {
    return fail(422, inspection.code, 'This HEIC/HEIF image variant is not supported.');
  }
  try {
    const result = await env.IMAGES
      .input(new Blob([bytes]).stream())
      .transform({ width: MAX_EDGE, height: MAX_EDGE, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 85, anim: false });
    const response = result.response();
    const headers = new Headers(response.headers);
    headers.set('content-type', 'image/webp');
    headers.set('cache-control', 'no-store');
    headers.set('x-content-type-options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    const providerCode = cloudflareErrorCode(error);
    if (providerCode === '9422') {
      return fail(429, 'IMAGES_QUOTA_EXCEEDED', 'Image conversion capacity is temporarily exhausted.', { 'retry-after': '3600' });
    }
    if (providerCode === '9413') {
      return fail(422, 'IMAGE_TOO_MANY_PIXELS', 'The image dimensions exceed the supported limit.');
    }
    return fail(502, 'HEIF_CONVERSION_FAILED', 'The HEIC/HEIF image could not be converted.');
  }
};

export default { fetch: handleRequest };

export const limits = { MAX_INPUT_BYTES, MAX_APP_INPUT_BYTES, MAX_OUTPUT_BYTES, MAX_SOURCE_PIXELS, MAX_EDGE };
