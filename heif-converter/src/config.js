const integer = (value, fallback, minimum, maximum, name) => {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
};

export function loadConfig(env = process.env) {
  const hmacSecret = env.HEIF_CONVERTER_HMAC_SECRET;
  if (typeof hmacSecret !== 'string' || Buffer.byteLength(hmacSecret, 'utf8') < 32) {
    throw new Error('HEIF_CONVERTER_HMAC_SECRET must contain at least 32 UTF-8 bytes');
  }

  return Object.freeze({
    host: env.HOST ?? '0.0.0.0',
    port: integer(env.PORT, 8080, 1, 65535, 'PORT'),
    hmacSecret,
    signatureWindowSeconds: integer(
      env.SIGNATURE_WINDOW_SECONDS,
      300,
      30,
      900,
      'SIGNATURE_WINDOW_SECONDS',
    ),
    maxBodyBytes: integer(env.MAX_BODY_BYTES, 15 * 1024 * 1024, 1024, 15 * 1024 * 1024, 'MAX_BODY_BYTES'),
    maxAggregatePixels: integer(env.MAX_AGGREGATE_PIXELS, 40_000_000, 1_000_000, 40_000_000, 'MAX_AGGREGATE_PIXELS'),
    maxConcurrency: integer(env.MAX_CONCURRENCY, 1, 1, 1, 'MAX_CONCURRENCY'),
    conversionTimeoutMs: integer(env.CONVERSION_TIMEOUT_MS, 15_000, 1_000, 30_000, 'CONVERSION_TIMEOUT_MS'),
    tempRoot: env.TEMP_ROOT ?? '/tmp/heif-converter',
    converterPath: env.HEIF_CONVERT_PATH ?? '/usr/local/bin/heif-convert',
    prlimitPath: env.PRLIMIT_PATH ?? '/usr/bin/prlimit',
    versionManifestPath: env.NATIVE_VERSION_MANIFEST ?? '/opt/heif-converter/native-versions.json',
  });
}
