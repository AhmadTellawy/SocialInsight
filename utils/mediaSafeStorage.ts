const MEDIA_VALUE_KEYS = new Set([
  'avatar',
  'coverImage',
  'image',
  'previewUrl',
  'src',
  'srcSet',
  'sources'
]);

const isEphemeralMediaValue = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('data:image/')
    || normalized.startsWith('blob:')
    || normalized.includes('/storage/v1/object/sign/')
    || /[?&](token|signature|x-amz-signature)=/i.test(value);
};

export const sanitizePersistedMedia = <T>(value: T): T => {
  const visit = (current: unknown, key?: string): unknown => {
    if (typeof current === 'string') {
      if (key && MEDIA_VALUE_KEYS.has(key) && (current.length > 100_000 || isEphemeralMediaValue(current))) {
        return undefined;
      }
      return current;
    }
    if (Array.isArray(current)) {
      return current.map((item) => visit(item)).filter((item) => item !== undefined);
    }
    if (!current || typeof current !== 'object') return current;

    const record = current as Record<string, unknown>;
    const restricted = record.access === 'RESTRICTED';
    const next: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(record)) {
      if (restricted && (childKey === 'src' || childKey === 'srcSet' || childKey === 'sources')) continue;
      const sanitized = visit(childValue, childKey);
      if (sanitized !== undefined) next[childKey] = sanitized;
    }
    return next;
  };

  return visit(value) as T;
};

export const writeMediaSafeJson = (key: string, value: unknown): void => {
  localStorage.setItem(key, JSON.stringify(sanitizePersistedMedia(value)));
};

export const readMediaSafeJson = <T>(key: string): T | null => {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    localStorage.removeItem(key);
    return null;
  }
  const sanitized = sanitizePersistedMedia(parsed) as T;
  try {
    writeMediaSafeJson(key, sanitized);
  } catch {
    // A safe in-memory value is still usable when storage is full or unavailable.
  }
  return sanitized;
};
