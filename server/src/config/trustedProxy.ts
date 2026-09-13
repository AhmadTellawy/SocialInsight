import { isIP } from 'node:net';

export const readTrustedProxyHops = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (!raw) {
    if (env.NODE_ENV === 'production') {
      throw new Error('TRUST_PROXY_HOPS must be explicitly configured in production.');
    }
    return 0;
  }
  if (!/^\d+$/.test(raw)) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 3.');
  const hops = Number(raw);
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 3) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 3.');
  }
  return hops;
};

const normalizedIpAddress = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase().startsWith('::ffff:') && isIP(trimmed.slice(7)) === 4
    ? trimmed.slice(7)
    : trimmed;
  return isIP(normalized) ? normalized.slice(0, 128) : undefined;
};

/**
 * Resolves the first untrusted address from the right, matching Express's
 * hop-count trust model. Untrusted deployments ignore X-Forwarded-For.
 */
export const resolveTrustedClientAddress = (
  remoteAddress: unknown,
  forwardedFor: string | string[] | undefined,
  trustedHops: number = readTrustedProxyHops()
): string => {
  const remote = normalizedIpAddress(remoteAddress) || 'unknown';
  if (trustedHops <= 0 || remote === 'unknown') return remote;

  const forwarded = (Array.isArray(forwardedFor) ? forwardedFor : [forwardedFor || ''])
    .flatMap((value) => value.split(','))
    .map(normalizedIpAddress)
    .filter((value): value is string => Boolean(value))
    .slice(-16);
  if (forwarded.length === 0) return remote;

  const chain = [...forwarded, remote];
  return chain[Math.max(0, chain.length - 1 - trustedHops)] || remote;
};
