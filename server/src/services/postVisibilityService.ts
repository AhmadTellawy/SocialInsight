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
    ...(viewerId ? { NOT: { hiddenBy: { some: { userId: viewerId } } } } : {}),
    OR: [nonGroupAudience, groupAudience]
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
