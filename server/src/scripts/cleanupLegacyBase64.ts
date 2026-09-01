import 'dotenv/config';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import prisma from '../prisma';
import { getMediaStorage, isMediaStorageConfigured } from '../services/mediaStorage';
import {
  LegacyBase64AssetSnapshot,
  LegacyBase64CleanupDomain,
  LegacyBase64EligibilityReason,
  LegacyBase64VariantSnapshot,
  buildExactLegacyBase64AssetWhere,
  downloadedVariantMatchesSnapshot,
  evaluateLegacyBase64CleanupCandidate,
  parseLegacyBase64BoundedInteger,
  parseLegacyBase64CleanupDomains,
  parseLegacyBase64ExpectedCounts
} from '../services/legacyBase64Cleanup';
import { GROUP_ROLES, MEMBERSHIP_STATUS } from '../utils/constants';

type PostMediaSnapshot = {
  id: string;
  mediaAssetId: string;
  sortOrder: number;
};

type CleanupCandidate = {
  domain: LegacyBase64CleanupDomain;
  id: string;
  source: string;
  authoritativeOwnerId?: string | null;
  asset?: LegacyBase64AssetSnapshot | null;
  postMedia?: PostMediaSnapshot | null;
};

type EligibleCandidate = CleanupCandidate & {
  asset: LegacyBase64AssetSnapshot;
  selectedVariant: LegacyBase64VariantSnapshot;
};

type DomainSummary = Record<LegacyBase64EligibilityReason, number> & {
  scanned: number;
  eligible: number;
  storageVerified: number;
  storageVerificationFailed: number;
  cleaned: number;
  conflict: number;
  failed: number;
};

class CleanupError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const argv = process.argv.slice(2);
const hasFlag = (name: string): boolean => argv.includes(`--${name}`);
const flagValue = (name: string): string | undefined =>
  argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);

const apply = hasFlag('apply');
const rawMediaReadApiBaseUrl = flagValue('verify-api-base-url');
const verifyViaApi = rawMediaReadApiBaseUrl !== undefined;
const verifyStorage = !verifyViaApi && (apply || hasFlag('verify-storage'));
const verifyMedia = verifyViaApi || verifyStorage;
const batchSize = parseLegacyBase64BoundedInteger(flagValue('batch-size'), 25, 1, 100);
const limit = parseLegacyBase64BoundedInteger(
  flagValue('limit'),
  Number.MAX_SAFE_INTEGER,
  1,
  Number.MAX_SAFE_INTEGER
);
const selectedDomains = parseLegacyBase64CleanupDomains(flagValue('domains'));
const expectedCounts = parseLegacyBase64ExpectedCounts(flagValue('expect'));
const rawExpectedTotal = flagValue('expect-total');
const expectedTotal = rawExpectedTotal === undefined ? undefined : Number(rawExpectedTotal);

if (expectedTotal !== undefined && (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0)) {
  throw new CleanupError('INVALID_EXPECTED_TOTAL');
}
if (verifyViaApi && hasFlag('verify-storage')) {
  throw new CleanupError('AMBIGUOUS_STORAGE_VERIFICATION');
}
if (Object.keys(expectedCounts).some((domain) =>
  !selectedDomains.includes(domain as LegacyBase64CleanupDomain))) {
  throw new CleanupError('EXPECTED_DOMAIN_NOT_SELECTED');
}

const parseMediaReadApiBaseUrl = (raw?: string): URL | undefined => {
  if (raw === undefined) return undefined;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)
        || parsed.username
        || parsed.password
        || parsed.search
        || parsed.hash) {
      throw new Error('invalid');
    }
    return parsed;
  } catch {
    throw new CleanupError('INVALID_MEDIA_READ_API_BASE_URL');
  }
};

const mediaReadApiBaseUrl = parseMediaReadApiBaseUrl(rawMediaReadApiBaseUrl);
const mediaReadApiToken = process.env.MEDIA_READ_API_TOKEN?.trim();
if (verifyViaApi && !mediaReadApiToken) {
  throw new CleanupError('MEDIA_READ_API_TOKEN_REQUIRED');
}
const allowAlreadyClean = hasFlag('allow-already-clean');
if (allowAlreadyClean && !apply) {
  throw new CleanupError('ALLOW_ALREADY_CLEAN_REQUIRES_APPLY');
}
const assetSelect = {
  id: true,
  ownerId: true,
  purpose: true,
  status: true,
  accessScope: true,
  sourceMime: true,
  sourceByteSize: true,
  checksum: true,
  aspectRatio: true,
  deletedAt: true,
  variants: {
    select: {
      id: true,
      mediaAssetId: true,
      kind: true,
      storageBucket: true,
      storageKey: true,
      width: true,
      height: true,
      mime: true,
      byteSize: true,
      isPublic: true
    }
  }
} satisfies Prisma.MediaAssetSelect;

const legacyPrefix = { startsWith: 'data:image/', mode: 'insensitive' as const };

const getCandidates = async (
  domain: LegacyBase64CleanupDomain,
  cursor: string | undefined,
  take: number
): Promise<CleanupCandidate[]> => {
  const id = cursor ? { gt: cursor } : undefined;
  if (domain === 'user') {
    const rows = await prisma.user.findMany({
      where: { id, avatar: legacyPrefix },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        avatar: true,
        avatarMedia: { select: assetSelect }
      }
    });
    return rows.map((row) => ({
      domain,
      id: row.id,
      source: row.avatar!,
      authoritativeOwnerId: row.id,
      asset: row.avatarMedia as LegacyBase64AssetSnapshot | null
    }));
  }

  if (domain === 'group') {
    const rows = await prisma.group.findMany({
      where: { id, image: legacyPrefix },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        image: true,
        imageMedia: { select: assetSelect },
        members: {
          where: { role: GROUP_ROLES.OWNER, status: MEMBERSHIP_STATUS.JOINED },
          orderBy: { id: 'asc' },
          take: 1,
          select: { userId: true }
        }
      }
    });
    return rows.map((row) => ({
      domain,
      id: row.id,
      source: row.image!,
      authoritativeOwnerId: row.members[0]?.userId,
      asset: row.imageMedia as LegacyBase64AssetSnapshot | null
    }));
  }

  if (domain === 'post') {
    const rows = await prisma.post.findMany({
      where: { id, image: legacyPrefix },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        image: true,
        authorId: true,
        media: {
          where: { sortOrder: 0 },
          take: 1,
          select: {
            id: true,
            mediaAssetId: true,
            sortOrder: true,
            mediaAsset: { select: assetSelect }
          }
        }
      }
    });
    return rows.map((row) => ({
      domain,
      id: row.id,
      source: row.image!,
      authoritativeOwnerId: row.authorId,
      asset: row.media[0]?.mediaAsset as LegacyBase64AssetSnapshot | undefined,
      postMedia: row.media[0]
        ? {
            id: row.media[0].id,
            mediaAssetId: row.media[0].mediaAssetId,
            sortOrder: row.media[0].sortOrder
          }
        : null
    }));
  }

  if (domain === 'question') {
    const rows = await prisma.question.findMany({
      where: { id, image: legacyPrefix },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        image: true,
        imageMedia: { select: assetSelect },
        post: { select: { authorId: true } },
        section: { select: { post: { select: { authorId: true } } } }
      }
    });
    return rows.map((row) => ({
      domain,
      id: row.id,
      source: row.image!,
      authoritativeOwnerId: row.post?.authorId || row.section?.post.authorId,
      asset: row.imageMedia as LegacyBase64AssetSnapshot | null
    }));
  }

  const rows = await prisma.option.findMany({
    where: { id, image: legacyPrefix },
    orderBy: { id: 'asc' },
    take,
    select: {
      id: true,
      image: true,
      imageMedia: { select: assetSelect },
      question: {
        select: {
          post: { select: { authorId: true } },
          section: { select: { post: { select: { authorId: true } } } }
        }
      }
    }
  });
  return rows.map((row) => ({
    domain,
    id: row.id,
    source: row.image!,
    authoritativeOwnerId: row.question.post?.authorId || row.question.section?.post.authorId,
    asset: row.imageMedia as LegacyBase64AssetSnapshot | null
  }));
};

const emptySummary = (): DomainSummary => ({
  scanned: 0,
  eligible: 0,
  invalidSource: 0,
  missingAuthoritativeOwner: 0,
  missingAsset: 0,
  ownerMismatch: 0,
  purposeMismatch: 0,
  assetNotAttached: 0,
  assetDeleted: 0,
  invalidAspectRatio: 0,
  sourceMimeMismatch: 0,
  sourceByteSizeMismatch: 0,
  checksumMismatch: 0,
  missingDisplayVariant: 0,
  storageVerified: 0,
  storageVerificationFailed: 0,
  cleaned: 0,
  conflict: 0,
  failed: 0
});

const summary = Object.fromEntries(
  selectedDomains.map((domain) => [domain, emptySummary()])
) as Record<LegacyBase64CleanupDomain, DomainSummary>;

const scanDomain = async (domain: LegacyBase64CleanupDomain): Promise<EligibleCandidate[]> => {
  const eligibleCandidates: EligibleCandidate[] = [];
  let cursor: string | undefined;
  let remaining = limit;
  while (remaining > 0) {
    const take = Math.min(batchSize, remaining);
    const candidates = await getCandidates(domain, cursor, take);
    if (candidates.length === 0) break;
    cursor = candidates[candidates.length - 1].id;
    remaining -= candidates.length;

    for (const candidate of candidates) {
      summary[domain].scanned += 1;
      const eligibility = evaluateLegacyBase64CleanupCandidate(
        domain,
        candidate.source,
        candidate.authoritativeOwnerId,
        candidate.asset
      );
      if (!eligibility.eligible) {
        summary[domain][eligibility.reason] += 1;
        continue;
      }
      if (domain === 'post' && (!candidate.postMedia || candidate.postMedia.sortOrder !== 0)) {
        summary[domain].missingAsset += 1;
        continue;
      }
      summary[domain].eligible += 1;
      eligibleCandidates.push({
        ...candidate,
        asset: candidate.asset!,
        selectedVariant: eligibility.variant
      });
    }
    if (candidates.length < take) break;
  }
  return eligibleCandidates;
};

const countRemaining = async (domain: LegacyBase64CleanupDomain): Promise<number> => {
  if (domain === 'user') return prisma.user.count({ where: { avatar: legacyPrefix } });
  if (domain === 'group') return prisma.group.count({ where: { image: legacyPrefix } });
  if (domain === 'post') return prisma.post.count({ where: { image: legacyPrefix } });
  if (domain === 'question') return prisma.question.count({ where: { image: legacyPrefix } });
  return prisma.option.count({ where: { image: legacyPrefix } });
};

const remainingCounts = async (): Promise<Record<LegacyBase64CleanupDomain, number>> =>
  (Object.fromEntries(await Promise.all(
    selectedDomains.map(async (domain) => [domain, await countRemaining(domain)])
  )) as Record<LegacyBase64CleanupDomain, number>);

const assertExpectedCounts = (): void => {
  const eligibleTotal = selectedDomains.reduce((total, domain) => total + summary[domain].eligible, 0);
  if (expectedTotal !== undefined && eligibleTotal !== expectedTotal) {
    throw new CleanupError('EXPECTED_TOTAL_MISMATCH');
  }
  for (const [domain, expected] of Object.entries(expectedCounts) as Array<[LegacyBase64CleanupDomain, number]>) {
    if (summary[domain].eligible !== expected) throw new CleanupError('EXPECTED_DOMAIN_COUNT_MISMATCH');
  }
};

const eligibilityReasons: LegacyBase64EligibilityReason[] = [
  'invalidSource',
  'missingAuthoritativeOwner',
  'missingAsset',
  'ownerMismatch',
  'purposeMismatch',
  'assetNotAttached',
  'assetDeleted',
  'invalidAspectRatio',
  'sourceMimeMismatch',
  'sourceByteSizeMismatch',
  'checksumMismatch',
  'missingDisplayVariant'
];

const assertApplyPreflightIsComplete = (
  remainingBefore: Record<LegacyBase64CleanupDomain, number>
): void => {
  for (const domain of selectedDomains) {
    const skipped = eligibilityReasons.reduce((total, reason) => total + summary[domain][reason], 0);
    if (skipped > 0
        || summary[domain].scanned !== summary[domain].eligible
        || remainingBefore[domain] !== summary[domain].eligible) {
      throw new CleanupError('APPLY_PREFLIGHT_INCOMPLETE');
    }
  }
};

const storageObjectMatchesVariant = async (
  downloaded: Buffer,
  variant: LegacyBase64VariantSnapshot
): Promise<boolean> => {
  if (!downloadedVariantMatchesSnapshot(downloaded, variant)) return false;
  const metadata = await sharp(downloaded, { failOn: 'error' }).metadata();
  const actualMime = metadata.format === 'jpeg'
    ? 'image/jpeg'
    : metadata.format ? `image/${metadata.format}` : '';
  return actualMime === variant.mime.toLowerCase()
    && metadata.width === variant.width
    && metadata.height === variant.height;
};

const fetchWithTimeout = async (url: string, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timeout);
  }
};

const downloadCandidateVariant = async (candidate: EligibleCandidate): Promise<Buffer> => {
  if (!mediaReadApiBaseUrl) {
    return getMediaStorage().download(
      candidate.selectedVariant.storageBucket,
      candidate.selectedVariant.storageKey
    );
  }

  const presentationUrl = new URL(
    `/api/media/${encodeURIComponent(candidate.asset.id)}`,
    mediaReadApiBaseUrl
  );
  const presentationResponse = await fetchWithTimeout(presentationUrl.toString(), {
    headers: { Authorization: `Bearer ${mediaReadApiToken}` }
  });
  if (!presentationResponse.ok) throw new Error('MEDIA_PRESENTATION_UNAVAILABLE');
  const presentation = await presentationResponse.json() as Record<string, unknown>;
  if (presentation.id !== candidate.asset.id
      || presentation.width !== candidate.selectedVariant.width
      || presentation.height !== candidate.selectedVariant.height
      || typeof presentation.src !== 'string') {
    throw new Error('MEDIA_PRESENTATION_MISMATCH');
  }

  const mediaUrl = new URL(presentation.src);
  if (mediaUrl.protocol !== 'https:') throw new Error('INSECURE_MEDIA_PRESENTATION_URL');
  const mediaResponse = await fetchWithTimeout(mediaUrl.toString());
  if (!mediaResponse.ok) throw new Error('MEDIA_DOWNLOAD_FAILED');
  const contentLength = Number(mediaResponse.headers.get('content-length'));
  if (Number.isFinite(contentLength)
      && contentLength > 0
      && contentLength !== candidate.selectedVariant.byteSize) {
    throw new Error('MEDIA_CONTENT_LENGTH_MISMATCH');
  }
  return Buffer.from(await mediaResponse.arrayBuffer());
};

const clearCandidate = async (candidate: EligibleCandidate): Promise<number> => {
  const exactAsset = buildExactLegacyBase64AssetWhere(candidate.asset, candidate.selectedVariant);
  if (candidate.domain === 'user') {
    return (await prisma.user.updateMany({
      where: {
        id: candidate.id,
        avatar: candidate.source,
        avatarMediaId: candidate.asset.id,
        avatarMedia: { is: exactAsset }
      },
      data: { avatar: null }
    })).count;
  }
  if (candidate.domain === 'group') {
    return (await prisma.group.updateMany({
      where: {
        id: candidate.id,
        image: candidate.source,
        imageMediaId: candidate.asset.id,
        imageMedia: { is: exactAsset },
        members: {
          some: {
            userId: candidate.asset.ownerId,
            role: GROUP_ROLES.OWNER,
            status: MEMBERSHIP_STATUS.JOINED
          }
        }
      },
      data: { image: null }
    })).count;
  }
  if (candidate.domain === 'post') {
    if (!candidate.postMedia) return 0;
    return (await prisma.post.updateMany({
      where: {
        id: candidate.id,
        image: candidate.source,
        authorId: candidate.asset.ownerId,
        media: {
          some: {
            id: candidate.postMedia.id,
            mediaAssetId: candidate.asset.id,
            sortOrder: 0,
            mediaAsset: { is: exactAsset }
          }
        }
      },
      data: { image: null }
    })).count;
  }
  if (candidate.domain === 'question') {
    return (await prisma.question.updateMany({
      where: {
        id: candidate.id,
        image: candidate.source,
        imageMediaId: candidate.asset.id,
        imageMedia: { is: exactAsset },
        OR: [
          { post: { is: { authorId: candidate.asset.ownerId } } },
          { section: { is: { post: { authorId: candidate.asset.ownerId } } } }
        ]
      },
      data: { image: null }
    })).count;
  }
  return (await prisma.option.updateMany({
    where: {
      id: candidate.id,
      image: candidate.source,
      imageMediaId: candidate.asset.id,
      imageMedia: { is: exactAsset },
      question: {
        is: {
          OR: [
            { post: { is: { authorId: candidate.asset.ownerId } } },
            { section: { is: { post: { authorId: candidate.asset.ownerId } } } }
          ]
        }
      }
    },
    data: { image: null }
  })).count;
};

const main = async (): Promise<void> => {
  if (verifyStorage && !isMediaStorageConfigured()) {
    throw new CleanupError('MEDIA_STORAGE_NOT_CONFIGURED');
  }
  console.log(JSON.stringify({
    event: 'legacy_base64_cleanup_started',
    mode: apply ? 'APPLY' : 'DRY_RUN',
    domainCount: selectedDomains.length,
    batchSize,
    limited: limit !== Number.MAX_SAFE_INTEGER,
    expectedCountGate: expectedTotal !== undefined || Object.keys(expectedCounts).length > 0,
    storageVerification: verifyMedia,
    verificationMethod: verifyViaApi ? 'MEDIA_READ_API' : verifyStorage ? 'STORAGE_CLIENT' : 'NONE',
    allowAlreadyClean
  }));

  const eligibleCandidates: EligibleCandidate[] = [];
  for (const domain of selectedDomains) eligibleCandidates.push(...await scanDomain(domain));
  const remainingBefore = await remainingCounts();
  if (allowAlreadyClean && selectedDomains.every((domain) => remainingBefore[domain] === 0)) {
    console.log(JSON.stringify({
      event: 'legacy_base64_cleanup_summary',
      mode: 'APPLY',
      summary,
      remaining: remainingBefore,
      alreadyClean: true
    }));
    return;
  }
  try {
    assertExpectedCounts();
    if (apply) assertApplyPreflightIsComplete(remainingBefore);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'legacy_base64_cleanup_preflight_failed',
      mode: apply ? 'APPLY' : 'DRY_RUN',
      summary,
      remaining: remainingBefore
    }));
    throw error;
  }

  if (verifyMedia) {
    for (const candidate of eligibleCandidates) {
      try {
        const downloaded = await downloadCandidateVariant(candidate);
        if (!(await storageObjectMatchesVariant(downloaded, candidate.selectedVariant))) {
          summary[candidate.domain].storageVerificationFailed += 1;
          continue;
        }
        summary[candidate.domain].storageVerified += 1;
      } catch {
        summary[candidate.domain].storageVerificationFailed += 1;
      }
    }

    const storageFailures = selectedDomains.reduce(
      (total, domain) => total + summary[domain].storageVerificationFailed,
      0
    );
    if (storageFailures > 0) {
      console.error(JSON.stringify({
        event: 'legacy_base64_cleanup_preflight_failed',
        mode: apply ? 'APPLY' : 'DRY_RUN',
        summary,
        remaining: remainingBefore
      }));
      throw new CleanupError('STORAGE_PREFLIGHT_FAILED');
    }
  }

  if (!apply) {
    console.log(JSON.stringify({
      event: 'legacy_base64_cleanup_summary',
      mode: 'DRY_RUN',
      summary,
      remaining: remainingBefore
    }));
    return;
  }

  for (const candidate of eligibleCandidates) {
    try {
      const count = await clearCandidate(candidate);
      if (count === 1) summary[candidate.domain].cleaned += 1;
      else summary[candidate.domain].conflict += 1;
    } catch {
      summary[candidate.domain].failed += 1;
    }
  }

  const remaining = await remainingCounts();
  console.log(JSON.stringify({
    event: 'legacy_base64_cleanup_summary',
    mode: 'APPLY',
    summary,
    remaining
  }));
  const incompleteWrites = selectedDomains.some((domain) =>
    summary[domain].conflict > 0
    || summary[domain].failed > 0
    || remaining[domain] > 0
  );
  if (incompleteWrites) throw new CleanupError('CLEANUP_INCOMPLETE');
};

main()
  .catch((error) => {
    console.error(JSON.stringify({
      event: 'legacy_base64_cleanup_fatal',
      code: error instanceof CleanupError ? error.code : 'UNEXPECTED_ERROR'
    }));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
