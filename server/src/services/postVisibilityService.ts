import { Prisma } from '@prisma/client';
import { MEMBERSHIP_STATUS, POST_STATUS } from '../utils/constants';
import { PrivacyService } from './privacyService';

const publicAudience = {
  OR: [
    { targetAudience: null },
    { targetAudience: { equals: 'Public', mode: 'insensitive' as const } }
  ]
};

const buildBaseVisiblePublishedPostWhere = (
  viewerId?: string | null
): Prisma.PostWhereInput => {
  const nonGroupAudience: Prisma.PostWhereInput = {
    AND: [
      {
        groupId: null,
        targetedGroups: { none: {} },
        OR: [
          publicAudience,
          ...(viewerId ? [
            { authorId: viewerId },
            {
              targetAudience: { equals: 'Followers', mode: 'insensitive' as const },
              author: { following: { some: { followerId: viewerId, status: 'ACTIVE' } } }
            }
          ] : [])
        ]
      },
      PrivacyService.getPostPrivacyWhereClause(viewerId)
    ]
  };

  const groupAudience: Prisma.PostWhereInput = {
    AND: [
      {
        OR: [
          { group: { is: { isPublic: true, isDeleted: false } } },
          { targetedGroups: { some: { isPublic: true, isDeleted: false } } },
          ...(viewerId ? [
            {
              group: {
                is: {
                  isDeleted: false,
                  members: { some: { userId: viewerId, status: MEMBERSHIP_STATUS.JOINED } }
                }
              }
            },
            {
              targetedGroups: {
                some: {
                  isDeleted: false,
                  members: { some: { userId: viewerId, status: MEMBERSHIP_STATUS.JOINED } }
                }
              }
            }
          ] : [])
        ]
      },
      ...(viewerId ? [
        {
          NOT: {
            author: {
              blockedBy: { some: { blockerId: viewerId } }
            }
          }
        },
        {
          NOT: {
            author: {
              blocking: { some: { blockedId: viewerId } }
            }
          }
        }
      ] : [])
    ]
  };

  return {
    isDeleted: false,
    status: POST_STATUS.PUBLISHED,
    author: { status: 'ACTIVE' },
    ...(viewerId ? { NOT: { hiddenBy: { some: { userId: viewerId } } } } : {}),
    OR: [nonGroupAudience, groupAudience, {
      AND: [
        { targetAudience: 'ProfileAndGroups' },
        PrivacyService.getPostPrivacyWhereClause(viewerId, true)
      ]
    }]
  };
};

export const buildVisiblePublishedPostWhere = (
  viewerId?: string | null
): Prisma.PostWhereInput => {
  const visiblePost = buildBaseVisiblePublishedPostWhere(viewerId);
  const visibleSource = buildBaseVisiblePublishedPostWhere(viewerId);

  return {
    ...visiblePost,
    AND: [
      {
        OR: [
          { sharedFromId: null },
          { sharedFrom: { is: visibleSource } }
        ]
      }
    ]
  };
};

export interface ResultsAccessPost {
  id: string;
  authorId: string;
  resultsWho?: string | null;
  resultsTiming?: string | null;
  expiresAt: Date;
}

export interface ResultsAccessDecision {
  allowed: boolean;
  viewerParticipated: boolean;
  reason?: 'audience' | 'timing';
}

/** Applies the same results audience and timing contract to every result surface. */
export const evaluatePostResultsAccess = async (
  db: any,
  post: ResultsAccessPost,
  viewerId?: string | null,
  guestProofHash?: string | null,
  now = new Date()
): Promise<ResultsAccessDecision> => {
  if (viewerId && viewerId === post.authorId) return { allowed: true, viewerParticipated: false };

  const who = (post.resultsWho || 'Public').trim().toLowerCase();
  const timing = (post.resultsTiming || 'AnyTime').trim().toLowerCase();
  const needsParticipation = who === 'participants' || timing === 'immediately';
  const responseIdentity = viewerId
    ? { userId: viewerId }
    : guestProofHash
      ? { guestProofHash, guestProofExpiresAt: { gt: now } }
      : null;

  const [follow, response] = await Promise.all([
    who === 'followers' && viewerId
      ? db.follow.findUnique({
          where: { followerId_followingId: { followerId: viewerId, followingId: post.authorId } },
          select: { status: true }
        })
      : Promise.resolve(null),
    needsParticipation && responseIdentity
      ? db.response.findFirst({ where: { postId: post.id, ...responseIdentity }, select: { id: true } })
      : Promise.resolve(null)
  ]);

  const viewerParticipated = Boolean(response);
  const audienceAllowed = who === 'public'
    || (who === 'followers' && follow?.status === 'ACTIVE')
    || (who === 'participants' && viewerParticipated);
  if (!audienceAllowed) return { allowed: false, viewerParticipated, reason: 'audience' };

  const timingAllowed = timing === 'anytime'
    || (timing === 'afterend' && post.expiresAt.getTime() <= now.getTime())
    || (timing === 'immediately' && viewerParticipated);
  return timingAllowed
    ? { allowed: true, viewerParticipated }
    : { allowed: false, viewerParticipated, reason: 'timing' };
};
