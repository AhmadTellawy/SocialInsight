import 'dotenv/config';
import { MediaAccessScope, MediaPurpose } from '@prisma/client';
import prisma from '../prisma';
import { MEDIA_CONFIG } from '../config/media';
import {
  commitPreparedMedia,
  createMediaUpload,
  finalizeMediaUpload,
  prepareMediaAttachments,
  purgeMediaAsset,
  resolvePostMediaScope,
  rollbackPreparedMedia
} from '../services/mediaService';
import { getMediaStorage, isMediaStorageConfigured } from '../services/mediaStorage';
import { MediaValidationError } from '../services/mediaProcessor';
import {
  isGeneratedAvatarFallback,
  loadLegacyMediaSource,
  parseLegacyMediaAllowedHosts
} from '../services/legacyMediaSource';
import { GROUP_ROLES, MEMBERSHIP_STATUS } from '../utils/constants';

type Domain = 'user' | 'group' | 'post' | 'question' | 'option';
type PostContext = {
  id: string;
  authorId: string;
  status: string;
  targetAudience: string | null;
  groupId: string | null;
  targetedGroups: Array<{ id: string }>;
};
type Candidate = {
  id: string;
  source: string;
  ownerId?: string;
  post?: PostContext | null;
};

const ALL_DOMAINS: Domain[] = ['user', 'group', 'post', 'question', 'option'];
const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const value = (name: string): string | undefined => argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const boundedInteger = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

const apply = flag('apply');
const batchSize = boundedInteger(value('batch-size'), 25, 1, 100);
const limit = boundedInteger(value('limit'), Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
const after = value('after');
const selectedDomains = (value('domains') || ALL_DOMAINS.join(','))
  .split(',')
  .map((domain) => domain.trim().toLowerCase())
  .filter((domain): domain is Domain => ALL_DOMAINS.includes(domain as Domain));
const allowedHosts = parseLegacyMediaAllowedHosts(
  [process.env.MEDIA_BACKFILL_ALLOWED_HOSTS, value('allow-hosts')].filter(Boolean).join(',')
);

if (selectedDomains.length === 0) throw new Error('No valid media backfill domains were selected.');
if (after && selectedDomains.length !== 1) throw new Error('--after may only be used with one selected domain.');
if (apply && !isMediaStorageConfigured()) throw new Error('Supabase media storage is not configured.');

const postSelect = {
  id: true,
  authorId: true,
  status: true,
  targetAudience: true,
  groupId: true,
  targetedGroups: { select: { id: true } }
} as const;

const getCandidates = async (domain: Domain, cursor: string | undefined, take: number): Promise<Candidate[]> => {
  const idFilter = cursor ? { gt: cursor } : undefined;
  if (domain === 'user') {
    const rows = await prisma.user.findMany({
      where: { id: idFilter, avatarMediaId: null, avatar: { not: null } },
      orderBy: { id: 'asc' }, take,
      select: { id: true, avatar: true }
    });
    return rows.map((row) => ({ id: row.id, ownerId: row.id, source: row.avatar! }));
  }
  if (domain === 'group') {
    const rows = await prisma.group.findMany({
      where: { id: idFilter, imageMediaId: null, image: { not: null }, isDeleted: false },
      orderBy: { id: 'asc' }, take,
      select: {
        id: true,
        image: true,
        members: {
          where: { role: GROUP_ROLES.OWNER, status: MEMBERSHIP_STATUS.JOINED },
          orderBy: { id: 'asc' },
          take: 1,
          select: { userId: true }
        }
      }
    });
    return rows.map((row) => ({ id: row.id, ownerId: row.members[0]?.userId, source: row.image! }));
  }
  if (domain === 'post') {
    const rows = await prisma.post.findMany({
      where: { id: idFilter, image: { not: null }, isDeleted: false, media: { none: {} } },
      orderBy: { id: 'asc' }, take,
      select: { ...postSelect, image: true }
    });
    return rows.map((row) => ({ id: row.id, ownerId: row.authorId, source: row.image!, post: row }));
  }
  if (domain === 'question') {
    const rows = await prisma.question.findMany({
      where: { id: idFilter, imageMediaId: null, image: { not: null } },
      orderBy: { id: 'asc' }, take,
      select: {
        id: true,
        image: true,
        post: { select: postSelect },
        section: { select: { post: { select: postSelect } } }
      }
    });
    return rows.map((row) => {
      const post = row.post || row.section?.post || null;
      return { id: row.id, ownerId: post?.authorId, source: row.image!, post };
    });
  }
  const rows = await prisma.option.findMany({
    where: { id: idFilter, imageMediaId: null, image: { not: null } },
    orderBy: { id: 'asc' }, take,
    select: {
      id: true,
      image: true,
      question: {
        select: {
          post: { select: postSelect },
          section: { select: { post: { select: postSelect } } }
        }
      }
    }
  });
  return rows.map((row) => {
    const post = row.question.post || row.question.section?.post || null;
    return { id: row.id, ownerId: post?.authorId, source: row.image!, post };
  });
};

const purposeFor = (domain: Domain): MediaPurpose => ({
  user: 'PROFILE_AVATAR',
  group: 'GROUP_IMAGE',
  post: 'POST',
  question: 'QUESTION_IMAGE',
  option: 'OPTION_IMAGE'
})[domain] as MediaPurpose;

const scopeFor = async (domain: Domain, candidate: Candidate): Promise<MediaAccessScope> => {
  if (domain === 'user' || domain === 'group') return 'PUBLIC';
  if (!candidate.post) throw new MediaValidationError('LEGACY_ORPHAN_MEDIA', 'Legacy image is not attached to a post.', 409);
  const groupIds = Array.from(new Set([
    ...(candidate.post.groupId ? [candidate.post.groupId] : []),
    ...candidate.post.targetedGroups.map(({ id }) => id)
  ]));
  return resolvePostMediaScope(
    candidate.post.authorId,
    candidate.post.status,
    groupIds,
    candidate.post.targetAudience
  );
};

const attachCandidate = async (
  domain: Domain,
  candidate: Candidate,
  assetId: string,
  aspectRatio: number,
  scope: MediaAccessScope
): Promise<void> => {
  const prepared = await prepareMediaAttachments(candidate.ownerId!, [{ id: assetId, purpose: purposeFor(domain) }], scope);
  try {
    await prisma.$transaction(async (tx) => {
      let count = 1;
      if (domain === 'user') {
        count = (await tx.user.updateMany({
          where: { id: candidate.id, avatarMediaId: null, avatar: candidate.source },
          data: { avatarMediaId: assetId }
        })).count;
      } else if (domain === 'group') {
        count = (await tx.group.updateMany({
          where: { id: candidate.id, imageMediaId: null, image: candidate.source },
          data: { imageMediaId: assetId }
        })).count;
      } else if (domain === 'post') {
        count = (await tx.post.updateMany({
          where: {
            id: candidate.id,
            image: candidate.source,
            isDeleted: false,
            media: { none: {} }
          },
          data: { mediaAspectRatio: aspectRatio }
        })).count;
        if (count !== 1) throw new MediaValidationError('BACKFILL_CONFLICT', 'Legacy image changed during migration.', 409);
        await tx.postMedia.create({ data: { postId: candidate.id, mediaAssetId: assetId, sortOrder: 0 } });
      } else if (domain === 'question') {
        count = (await tx.question.updateMany({
          where: { id: candidate.id, imageMediaId: null, image: candidate.source },
          data: { imageMediaId: assetId }
        })).count;
      } else {
        count = (await tx.option.updateMany({
          where: { id: candidate.id, imageMediaId: null, image: candidate.source },
          data: { imageMediaId: assetId }
        })).count;
      }
      if (count !== 1) throw new MediaValidationError('BACKFILL_CONFLICT', 'Legacy image changed during migration.', 409);
      await commitPreparedMedia(tx, prepared);
    });
  } catch (error) {
    await rollbackPreparedMedia(prepared);
    throw error;
  }
};

const migrateCandidate = async (domain: Domain, candidate: Candidate) => {
  if (!candidate.ownerId) throw new MediaValidationError('LEGACY_OWNER_MISSING', 'Legacy image has no authoritative owner.', 409);
  const loaded = await loadLegacyMediaSource(candidate.source, allowedHosts);
  const scope = await scopeFor(domain, candidate);
  let assetId: string | undefined;
  try {
    const upload = await createMediaUpload(candidate.ownerId, purposeFor(domain), loaded.mime, loaded.buffer.length);
    assetId = upload.assetId;
    await getMediaStorage().upload(upload.bucket, upload.path, loaded.buffer, loaded.mime, '3600');
    const finalized = await finalizeMediaUpload(candidate.ownerId, assetId, {});
    if (!finalized.aspectRatio) throw new MediaValidationError('PROCESSING_FAILED', 'Legacy image did not produce a valid ratio.', 409);
    await attachCandidate(domain, candidate, assetId, finalized.aspectRatio, scope);
    return { assetId, sourceKind: loaded.sourceKind, scope };
  } catch (error) {
    if (assetId) await purgeMediaAsset(assetId).catch(() => undefined);
    throw error;
  }
};

const summary: Record<Domain, Record<string, number | string | null>> = Object.fromEntries(
  ALL_DOMAINS.map((domain) => [domain, {
    scanned: 0,
    eligible: 0,
    migrated: 0,
    generatedFallback: 0,
    unsupportedRemote: 0,
    missingOwner: 0,
    failed: 0,
    resumeCursor: null
  }])
) as unknown as Record<Domain, Record<string, number | string | null>>;

const classifyDryRun = (domain: Domain, candidate: Candidate): string => {
  if (!candidate.ownerId) return 'missingOwner';
  if (domain === 'user' && isGeneratedAvatarFallback(candidate.source)) return 'generatedFallback';
  if (candidate.source.startsWith('data:image/')) return 'eligible';
  try {
    const hostname = new URL(candidate.source).hostname.toLowerCase();
    return allowedHosts.has(hostname) ? 'eligible' : 'unsupportedRemote';
  } catch {
    return 'unsupportedRemote';
  }
};

const runDomain = async (domain: Domain): Promise<void> => {
  let cursor = after;
  let remaining = limit;
  while (remaining > 0) {
    const candidates = await getCandidates(domain, cursor, Math.min(batchSize, remaining));
    if (candidates.length === 0) break;
    for (const candidate of candidates) {
      cursor = candidate.id;
      summary[domain].resumeCursor = cursor;
      summary[domain].scanned = Number(summary[domain].scanned) + 1;
      remaining -= 1;

      if (!apply) {
        const classification = classifyDryRun(domain, candidate);
        summary[domain][classification] = Number(summary[domain][classification]) + 1;
        continue;
      }
      if (domain === 'user' && isGeneratedAvatarFallback(candidate.source)) {
        summary[domain].generatedFallback = Number(summary[domain].generatedFallback) + 1;
        continue;
      }
      try {
        const result = await migrateCandidate(domain, candidate);
        summary[domain].migrated = Number(summary[domain].migrated) + 1;
        console.log(JSON.stringify({ event: 'media_backfill_migrated', domain, entityId: candidate.id, mediaId: result.assetId, sourceKind: result.sourceKind, scope: result.scope }));
      } catch (error) {
        const code = error instanceof MediaValidationError ? error.code : 'UNEXPECTED_ERROR';
        if (code === 'LEGACY_HOST_NOT_ALLOWED' || code === 'LEGACY_SOURCE_UNSUPPORTED') {
          summary[domain].unsupportedRemote = Number(summary[domain].unsupportedRemote) + 1;
        } else if (code === 'LEGACY_OWNER_MISSING' || code === 'LEGACY_ORPHAN_MEDIA') {
          summary[domain].missingOwner = Number(summary[domain].missingOwner) + 1;
        } else {
          summary[domain].failed = Number(summary[domain].failed) + 1;
        }
        console.error(JSON.stringify({ event: 'media_backfill_failed', domain, entityId: candidate.id, code }));
      }
    }
    if (candidates.length < Math.min(batchSize, remaining + candidates.length)) break;
  }
};

const main = async (): Promise<void> => {
  console.log(JSON.stringify({
    event: 'media_backfill_started',
    mode: apply ? 'APPLY' : 'DRY_RUN',
    domains: selectedDomains,
    batchSize,
    allowedHostCount: allowedHosts.size,
    maxInputBytes: MEDIA_CONFIG.maxInputBytes
  }));
  for (const domain of selectedDomains) await runDomain(domain);
  console.log(JSON.stringify({ event: 'media_backfill_summary', mode: apply ? 'APPLY' : 'DRY_RUN', summary }));
};

main()
  .catch((error) => {
    console.error(JSON.stringify({ event: 'media_backfill_fatal', code: error instanceof MediaValidationError ? error.code : 'UNEXPECTED_ERROR' }));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
