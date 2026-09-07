import { Prisma } from '@prisma/client';
import { lockAccountSecurity } from './mfaService';
import { GROUP_ROLES, MEMBERSHIP_STATUS } from '../utils/constants';

export class GroupOwnershipError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}

export const lockGroupRow = async (tx: Prisma.TransactionClient, groupId: string) => {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Group" WHERE id = ${groupId} FOR UPDATE`);
  return tx.group.findUnique({ where: { id: groupId } });
};

// Lock order matches account lifecycle: account-security, users, then Group.
// Taking the group lock before counting owners serializes all owner exits.
export const lockGroupMutation = async (tx: Prisma.TransactionClient, groupId: string, actorId: string, targetId?: string) => {
  const ids = [...new Set([actorId, targetId].filter((id): id is string => Boolean(id)))].sort();
  for (const id of ids) await lockAccountSecurity(tx, id);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { status: true } });
  if (actor?.status !== 'ACTIVE') throw new GroupOwnershipError('AUTH_REQUIRED', 401);
  const group = await lockGroupRow(tx, groupId);
  if (!group || group.isDeleted) throw new GroupOwnershipError('GROUP_NOT_FOUND', 404);
  return group;
};

export const countOtherActiveOwners = (tx: Prisma.TransactionClient, groupId: string, excludedUserId: string) =>
  tx.groupMember.count({ where: { groupId, userId: { not: excludedUserId }, role: GROUP_ROLES.OWNER, status: MEMBERSHIP_STATUS.JOINED, user: { status: 'ACTIVE' } } });

// Caller holds Group row lock, including callers from account deactivation.
export const assertOtherActiveOwner = async (tx: Prisma.TransactionClient, groupId: string, excludedUserId: string): Promise<void> => {
  if (!(await countOtherActiveOwners(tx, groupId, excludedUserId))) throw new GroupOwnershipError('GROUP_OWNERSHIP_REQUIRED');
};
