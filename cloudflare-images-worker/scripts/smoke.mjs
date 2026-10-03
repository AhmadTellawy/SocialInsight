import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const workerUrl = process.argv[2]?.replace(/\/$/, '');
if (!workerUrl?.startsWith('https://')) throw new Error('An HTTPS Worker URL is required.');
const allowMissingFixtures = process.argv.includes('--allow-missing-fixtures');

const secret = await new Promise((resolve, reject) => {
  let value = '';
  const onData = (chunk) => {
    value += chunk.toString('utf8');
    const newline = value.search(/[\r\n]/);
    if (newline < 0) return;
    process.stdin.off('data', onData);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    resolve(value.slice(0, newline).trim());
  };
  process.stdin.on('data', onData);
  process.stdin.once('error', reject);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
});
if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Converter secret is invalid.');

const fixtureRoot = process.env.TEMP;
const samples = [
  { id: 'iphone-12mp', path: `${fixtureRoot}\\socialinsight-media-phone-fixtures\\iphone_13_pro_max.HEIC`, mime: 'image/heic', expected: [1800, 2400] },
  { id: 'iphone-24mp', path: `${fixtureRoot}\\socialinsight-heif-highres-20261002\\iphone24-drive.bin`, mime: 'image/heic', expected: [2400, 1800] },
  { id: 'iphone-48mp', path: `${fixtureRoot}\\socialinsight-cloudflare-poc-48\\High Efficiency 24MP (normal thumbnail).HEIC`, mime: 'image/heic', expected: [1800, 2400] },
  { id: 'android-heif-filename', path: `${fixtureRoot}\\socialinsight-media-phone-fixtures\\HMD_Nokia_8.3_5G.heif`, mime: 'image/heif', expected: [1800, 2400] }
];

const webpDimensions = (bytes) => {
  if (bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
  const chunk = bytes.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
  if (chunk === 'VP8L' && bytes[20] === 0x2f) return [
    1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
    1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10))
  ];
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  }
  return null;
};

const browserDecode = (page, bytes) => page.evaluate((source) => new Promise(resolve => {
  const image = new Image();
  image.onload = () => resolve({ decoded: true, width: image.naturalWidth, height: image.naturalHeight });
  image.onerror = () => resolve({ decoded: false, width: 0, height: 0 });
  image.src = source;
}), `data:image/webp;base64,${bytes.toString('base64')}`);

const signedHeaders = (bytes, mime) => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const requestId = randomUUID();
  const bodyHash = createHash('sha256').update(bytes).digest('hex');
  return {
    'content-type': 'application/octet-stream',
    'content-length': String(bytes.length),
    'x-si-source-mime': mime,
    'x-si-timestamp': timestamp,
    'x-si-request-id': requestId,
    'x-si-body-sha256': bodyHash,
    'x-si-signature': `v1=${createHmac('sha256', secret).update(`v1\n${timestamp}\n${requestId}\n${bodyHash}`).digest('hex')}`
  };
};

const health = await fetch(`${workerUrl}/health/ready`);
if (!health.ok) throw new Error(`Readiness failed: ${health.status}`);
const unauthorized = await fetch(`${workerUrl}/v1/convert`, {
  method: 'POST',
  headers: { 'content-type': 'application/octet-stream', 'content-length': '1' },
  body: new Uint8Array([0])
});
if (unauthorized.status !== 401) throw new Error(`Unauthenticated request was not rejected: ${unauthorized.status}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const results = [];
try {
  for (const sample of samples) {
    let source;
    try {
      source = await readFile(sample.path);
    } catch (error) {
      if (!allowMissingFixtures || error?.code !== 'ENOENT') throw error;
      results.push({ id: sample.id, skipped: 'fixture-missing' });
      continue;
    }
    const startedAt = performance.now();
    const response = await fetch(`${workerUrl}/v1/convert`, {
      method: 'POST', headers: signedHeaders(source, sample.mime), body: source
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    const output = Buffer.from(await response.arrayBuffer());
    const dimensions = webpDimensions(output);
    const decoded = dimensions ? await browserDecode(page, output) : { decoded: false, width: 0, height: 0 };
    const pass = response.status === 200
      && response.headers.get('content-type')?.startsWith('image/webp')
      && dimensions?.[0] === sample.expected[0] && dimensions?.[1] === sample.expected[1]
      && decoded.decoded && decoded.width === sample.expected[0] && decoded.height === sample.expected[1];
    results.push({
      id: sample.id,
      sourceBytes: source.length,
      status: response.status,
      errorCode: response.headers.get('x-si-error-code'),
      outputBytes: output.length,
      dimensions,
      browserDecoded: decoded.decoded,
      elapsedMs,
      pass
    });
  }
} finally {
  await browser.close();
}

const report = { health: health.status, unauthenticatedStatus: unauthorized.status, results };
console.log(JSON.stringify(report, null, 2));
const executed = results.filter(result => !result.skipped);
if (executed.length === 0 || !executed.every(result => result.pass)) process.exitCode = 1;
