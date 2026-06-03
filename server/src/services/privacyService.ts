import { PrismaClient } from '@prisma/client';
import prisma from '../prisma';

export class PrivacyService {
  /**
   * Central authorization logic to determine if `viewerId` can view `ownerId`'s content.
   */
  static async canViewUserContent(viewerId: string | undefined | null, ownerId: string): Promise<boolean> {
    if (!viewerId) {
      const owner = await prisma.user.findUnique({
        where: { id: ownerId },
        select: { isPrivate: true }
      });
      return !owner?.isPrivate;
    }

    if (viewerId === ownerId) {
      return true; 
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
      select: { isPrivate: true }
    });

    if (!owner) {
      return false; 
    }

    if (!owner.isPrivate) {
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
  static getPostPrivacyWhereClause(viewerId?: string | null): any {
    if (!viewerId) {
      // Guests only see public content
      return {
        author: {
          isPrivate: false
        }
      };
    }

    return {
      AND: [
        {
          OR: [
            { authorId: viewerId },
            { author: { isPrivate: false } },
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
