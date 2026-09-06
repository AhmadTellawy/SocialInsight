import prisma from '../prisma';
import { PrivacyService } from './privacyService';
import { buildVisiblePublishedPostWhere } from './postVisibilityService';

export const isProfileAndGroups = (audience: unknown): boolean => audience === 'ProfileAndGroups';

export const validateProfileAndGroupsInput = (audience: unknown, groupIds: unknown, isDraft: boolean): string | null => {
  if (!isProfileAndGroups(audience)) return null;
  if (!Array.isArray(groupIds) || groupIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(groupIds).size !== groupIds.length) {
    return 'Select valid, unique target groups.';
  }
  if (!isDraft && groupIds.length === 0) return 'Select at least one group.';
  return null;
};

// Reading a public group does not alone grant the right to participate in it.
export const canInteractWithProfileAndGroups = async (postId: string, authorId: string, viewerId: string | null | undefined, groupIds: string[]): Promise<boolean> => {
  const visible = await prisma.post.count({ where: { id: postId, ...buildVisiblePublishedPostWhere(viewerId) } });
  if (!visible) return false;
  if (await PrivacyService.canViewUserContent(viewerId, authorId)) return true;
  if (!viewerId) return false;
  return !!(await prisma.groupMember.findFirst({
    where: { userId: viewerId, groupId: { in: groupIds }, status: 'JOINED', group: { isDeleted: false } },
    select: { userId: true }
  }));
};
