import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { lockAccountSecurity } from './mfaService';
import { notify } from './notificationService';

// The stored request to become public authorizes background acceptance. Every
// individual grant still checks the account's current state under the same
// account locks used by privacy changes, blocking and account deletion.
export async function acceptPendingPublicFollowers(userId: string, authorize?: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<number> {
  let cursor: string | undefined, acceptedCount = 0;
  for (;;) {
    const pending = await prisma.follow.findMany({
      where: { followingId: userId, status: 'PENDING', follower: { status: 'ACTIVE' }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' }, take: 250, select: { id: true, followerId: true }
    });
    for (const request of pending) {
      const accepted = await prisma.$transaction(async tx => {
        for (const id of [...new Set([userId, request.followerId])].sort()) await lockAccountSecurity(tx, id);
        if (authorize) await authorize(tx);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${userId}, ${request.followerId}) ORDER BY id FOR UPDATE`);
        const current = await tx.user.findUnique({ where: { id: userId }, select: { status: true, isPrivate: true, mediaPrivacyTarget: true } });
        if (current?.status !== 'ACTIVE' || current.isPrivate || current.mediaPrivacyTarget !== null) return false;
        const [blocked, follower] = await Promise.all([
          tx.userBlock.findFirst({ where: { OR: [{ blockerId: userId, blockedId: request.followerId }, { blockerId: request.followerId, blockedId: userId }] } }),
          tx.user.findUnique({ where: { id: request.followerId }, select: { status: true } })
        ]);
        if (blocked || follower?.status !== 'ACTIVE') return false;
        const changed = await tx.follow.updateMany({ where: { id: request.id, followingId: userId, followerId: request.followerId, status: 'PENDING' }, data: { status: 'ACTIVE', approvedAt: new Date() } });
        if (changed.count !== 1) return false;
        await tx.user.update({ where: { id: userId }, data: { followersCount: { increment: 1 } } });
        await tx.user.update({ where: { id: request.followerId }, data: { followingCount: { increment: 1 } } });
        return true;
      });
      if (accepted) {
        acceptedCount++;
        await notify(userId, request.followerId, 'follow_accept', 'Automatically accepted your follow request', 'profile', userId);
      }
    }
    if (pending.length < 250) return acceptedCount;
    cursor = pending[pending.length - 1].id;
  }
}
