import { Prisma, PrismaClient, ProfileLink } from '@prisma/client';
import prisma from '../prisma';
import {
  PROFILE_LINK_LIMIT,
  ProfileValidationError,
  normalizeProfileLinkInput
} from '../utils/profileValidation';

type ProfileLinkClient = Pick<PrismaClient, 'profileLink' | '$transaction'>;

const duplicateError = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');

const publicLink = (link: ProfileLink) => ({
  id: link.id,
  title: link.title,
  url: link.url,
  normalizedUrl: link.normalizedUrl,
  sortOrder: link.sortOrder,
  createdAt: link.createdAt,
  updatedAt: link.updatedAt
});

export const listProfileLinks = async (userId: string, client: ProfileLinkClient = prisma) => {
  const links = await client.profileLink.findMany({ where: { userId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  return links.map(publicLink);
};

export const createProfileLink = async (
  userId: string,
  input: { title?: unknown; url?: unknown },
  client: ProfileLinkClient = prisma
) => {
  const normalized = normalizeProfileLinkInput(input.title, input.url);
  try {
    const link = await client.$transaction(async (tx) => {
      const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`
      );
      if (lockedUsers.length !== 1) {
        throw new ProfileValidationError('USER_NOT_FOUND', 'User was not found.', 404);
      }
      const existing = await tx.profileLink.findMany({
        where: { userId },
        select: { sortOrder: true },
        orderBy: { sortOrder: 'asc' }
      });
      if (existing.length >= PROFILE_LINK_LIMIT) {
        throw new ProfileValidationError('PROFILE_LINK_LIMIT_REACHED', 'A profile can contain at most 5 links.', 409);
      }
      const occupied = new Set(existing.map(({ sortOrder }) => sortOrder));
      const sortOrder = Array.from({ length: PROFILE_LINK_LIMIT }, (_, index) => index).find((index) => !occupied.has(index));
      if (sortOrder === undefined) {
        throw new ProfileValidationError('PROFILE_LINK_LIMIT_REACHED', 'A profile can contain at most 5 links.', 409);
      }
      return tx.profileLink.create({ data: { userId, ...normalized, sortOrder } });
    });
    return publicLink(link);
  } catch (error) {
    if (duplicateError(error)) {
      throw new ProfileValidationError('DUPLICATE_PROFILE_LINK', 'This link is already on your profile.', 409);
    }
    throw error;
  }
};

export const updateProfileLink = async (
  userId: string,
  linkId: string,
  input: { title?: unknown; url?: unknown },
  client: ProfileLinkClient = prisma
) => {
  const normalized = normalizeProfileLinkInput(input.title, input.url);
  try {
    return await client.$transaction(async (tx) => {
      const result = await tx.profileLink.updateMany({
        where: { id: linkId, userId },
        data: normalized
      });
      if (result.count !== 1) {
        throw new ProfileValidationError('PROFILE_LINK_NOT_FOUND', 'Profile link was not found.', 404);
      }
      const link = await tx.profileLink.findUniqueOrThrow({ where: { id: linkId } });
      return publicLink(link);
    });
  } catch (error) {
    if (duplicateError(error)) {
      throw new ProfileValidationError('DUPLICATE_PROFILE_LINK', 'This link is already on your profile.', 409);
    }
    throw error;
  }
};

export const deleteProfileLink = async (
  userId: string,
  linkId: string,
  client: ProfileLinkClient = prisma
): Promise<void> => {
  const result = await client.profileLink.deleteMany({ where: { id: linkId, userId } });
  if (result.count !== 1) {
    throw new ProfileValidationError('PROFILE_LINK_NOT_FOUND', 'Profile link was not found.', 404);
  }
};
