import { promises as dns } from 'dns';
import { Agent } from 'https';
import { BlockList, isIP } from 'net';
import fetch from 'node-fetch';
import { AllowedMediaMime, MEDIA_CONFIG, isAllowedMediaMime } from '../config/media';
import { MediaValidationError } from './mediaProcessor';

export type LoadedLegacyMedia = {
  buffer: Buffer;
  mime: AllowedMediaMime;
  sourceKind: 'DATA_URL' | 'ALLOWLISTED_REMOTE';
};

const GENERATED_AVATAR_HOSTS = new Set([
  'ui-avatars.com',
  'api.dicebear.com',
  'picsum.photos',
  'randomuser.me'
]);

export const isGeneratedAvatarFallback = (value: string): boolean => {
  try {
    return GENERATED_AVATAR_HOSTS.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
};

export const parseLegacyMediaAllowedHosts = (value?: string): Set<string> => new Set(
  (value || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
);

const disallowedNetworks = new BlockList();
[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
].forEach(([address, prefix]) => disallowedNetworks.addSubnet(address as string, prefix as number, 'ipv4'));
[
  ['::', 128],
  ['::1', 128],
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
].forEach(([address, prefix]) => disallowedNetworks.addSubnet(address as string, prefix as number, 'ipv6'));

export const isDisallowedLegacyAddress = (address: string): boolean => {
  const normalized = address.toLowerCase();
  const family = isIP(normalized);
  if (family === 4) return disallowedNetworks.check(normalized, 'ipv4');
  if (family !== 6) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped
    ? disallowedNetworks.check(mapped, 'ipv4')
    : disallowedNetworks.check(normalized, 'ipv6');
};

type ResolvedRemoteUrl = {
  url: URL;
  addresses: Array<{ address: string; family: number }>;
};

const validateRemoteUrl = async (value: string, allowedHosts: Set<string>): Promise<ResolvedRemoteUrl> => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MediaValidationError('LEGACY_SOURCE_UNSUPPORTED', 'Legacy image source is not a valid URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new MediaValidationError('LEGACY_SOURCE_UNSUPPORTED', 'Legacy remote images require a standard HTTPS URL.');
  }
  const hostname = url.hostname.toLowerCase();
  if (!allowedHosts.has(hostname)) {
    throw new MediaValidationError('LEGACY_HOST_NOT_ALLOWED', 'Legacy remote image host is not allowlisted.');
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isDisallowedLegacyAddress(address))) {
    throw new MediaValidationError('LEGACY_HOST_UNSAFE', 'Legacy remote image host resolved to a disallowed network.');
  }
  return { url, addresses };
};

const createPinnedAgent = (addresses: Array<{ address: string; family: number }>): Agent => new Agent({
  lookup: ((_hostname: string, options: any, callback: any) => {
    const requestedFamily = Number(typeof options === 'number' ? options : options?.family || 0);
    const candidates = requestedFamily > 0
      ? addresses.filter(({ family }) => family === requestedFamily)
      : addresses;
    if (candidates.length === 0) {
      callback(Object.assign(new Error('No approved address is available.'), { code: 'ENOTFOUND' }));
      return;
    }
    if (options?.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  }) as any
});

const loadDataUrl = (value: string): LoadedLegacyMedia => {
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match || !isAllowedMediaMime(match[1].toLowerCase())) {
    throw new MediaValidationError('LEGACY_DATA_URL_INVALID', 'Legacy image data URL is invalid or unsupported.');
  }
  const encoded = match[2].replace(/\s/g, '');
  if (Math.ceil(encoded.length * 0.75) > MEDIA_CONFIG.maxInputBytes) {
    throw new MediaValidationError('INVALID_FILE_SIZE', 'Legacy image exceeds the 15 MB migration limit.');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length === 0 || buffer.length > MEDIA_CONFIG.maxInputBytes) {
    throw new MediaValidationError('INVALID_FILE_SIZE', 'Legacy image exceeds the 15 MB migration limit.');
  }
  return { buffer, mime: match[1].toLowerCase() as AllowedMediaMime, sourceKind: 'DATA_URL' };
};

const loadAllowlistedRemote = async (value: string, allowedHosts: Set<string>): Promise<LoadedLegacyMedia> => {
  let remote = await validateRemoteUrl(value, allowedHosts);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(remote.url.toString(), {
      redirect: 'manual',
      size: MEDIA_CONFIG.maxInputBytes,
      timeout: 15_000,
      agent: createPinnedAgent(remote.addresses),
      headers: { Accept: MEDIA_CONFIG.allowedMimeTypes.join(', ') }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirect === 3) {
        throw new MediaValidationError('LEGACY_REMOTE_REDIRECT', 'Legacy image redirect could not be followed safely.');
      }
      remote = await validateRemoteUrl(new URL(location, remote.url).toString(), allowedHosts);
      continue;
    }
    if (!response.ok) {
      throw new MediaValidationError('LEGACY_REMOTE_UNAVAILABLE', 'Legacy remote image could not be downloaded.');
    }
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!mime || !isAllowedMediaMime(mime)) {
      throw new MediaValidationError('UNSUPPORTED_MEDIA_TYPE', 'Legacy remote image has an unsupported content type.');
    }
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MEDIA_CONFIG.maxInputBytes) {
      throw new MediaValidationError('INVALID_FILE_SIZE', 'Legacy remote image exceeds the 15 MB migration limit.');
    }
    const buffer = await response.buffer();
    if (buffer.length === 0 || buffer.length > MEDIA_CONFIG.maxInputBytes) {
      throw new MediaValidationError('INVALID_FILE_SIZE', 'Legacy remote image exceeds the 15 MB migration limit.');
    }
    return { buffer, mime, sourceKind: 'ALLOWLISTED_REMOTE' };
  }
  throw new MediaValidationError('LEGACY_REMOTE_REDIRECT', 'Legacy image redirect could not be followed safely.');
};

export const loadLegacyMediaSource = async (value: string, allowedHosts: Set<string>): Promise<LoadedLegacyMedia> => {
  if (value.startsWith('data:image/')) return loadDataUrl(value);
  return loadAllowlistedRemote(value, allowedHosts);
};
