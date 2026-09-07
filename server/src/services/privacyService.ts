import { PrismaClient } from '@prisma/client';
import prisma from '../prisma';

export class PrivacyService {
  static getDiscoverableUserWhere(viewerId?: string | null): any {
    return {
      status: 'ACTIVE', searchVisibility: true,
      ...(viewerId ? { NOT: [{ blockedBy: { some: { blockerId: viewerId } } }, { blocking: { some: { blockedId: viewerId } } }] } : {})
    };
  }
  /**
   * Central authorization logic to determine if `viewerId` can view `ownerId`'s content.
   */
  static async canViewUserContent(viewerId: string | undefined | null, ownerId: string): Promise<boolean> {
    if (!viewerId) {
      const owner = await prisma.user.findUnique({
        where: { id: ownerId },
        select: { isPrivate: true, mediaPrivacyTarget: true, status: true }
      });
      return owner !== null && owner.status === 'ACTIVE' && !(owner.isPrivate || owner.mediaPrivacyTarget === true);
    }

    if (viewerId === ownerId) {
      const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { status: true } });
      return owner?.status === 'ACTIVE';
    }

    const blockRecord = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: ownerId },
          { blockerId: ownerId, blockedId: viewerId }
        ]
      }
    });

    if (blockRecord) {
      return false; 
    }

    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { isPrivate: true, mediaPrivacyTarget: true, status: true }
    });

    if (!owner || owner.status !== 'ACTIVE') {
      return false; 
    }

    if (!owner.isPrivate && owner.mediaPrivacyTarget !== true) {
      return true; 
    }

    const followRecord = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: viewerId,
          followingId: ownerId
        }
      }
    });

    if (followRecord && followRecord.status === 'ACTIVE') {
      return true;
    }

    return false;
  }

  /**
   * Returns a Prisma query object to inject into a `where` clause when querying Post/User tables
   * to automatically exclude blocked users and private users you don't follow.
   * Usage:
   * prisma.post.findMany({
   *   where: {
   *     ...PrivacyService.getPostPrivacyWhereClause(userId),
   *     // other conditions
   *   }
   * })
   */
  static getPostPrivacyWhereClause(viewerId?: string | null, includeUnsetMediaPrivacy = false): any {
    // SQL NOT true excludes NULL. The additive profile destination follows
    // canViewUserContent, where an unset transition flag is not private.
    // Keep the legacy query shape unless the new destination opts in.
    const mediaPrivacyWhere = { OR: [{ mediaPrivacyTarget: false }, { mediaPrivacyTarget: null }] };
    if (!viewerId) {
      // Guests only see public content
      return {
        author: {
          status: 'ACTIVE',
          isPrivate: false,
          ...mediaPrivacyWhere
        }
      };
    }

    return {
      AND: [
        { author: { status: 'ACTIVE' } },
        {
          OR: [
            { authorId: viewerId },
            { author: { isPrivate: false, ...mediaPrivacyWhere } },
            { author: { following: { some: { followerId: viewerId, status: 'ACTIVE' } } } }
          ]
        },
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
      ]
    };
  }
}
