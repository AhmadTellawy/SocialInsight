import { Prisma } from '@prisma/client';
import { loadVisiblePostScalars } from './postVisibilitySql';

/** The same visibility policy as the feed, including both source ancestors.
 * Personal posts need one indexed scalar lookup. Reposts alone need a second.
 * Always call within the response's snapshot; never cache authorization. */
export async function loadVisibleInteractionTarget(tx: Prisma.TransactionClient, rawId: string,
  type: 'vote' | 'comment' | 'like', viewerId?: string) {
  const [post] = await loadVisiblePostScalars(tx, { ids: [rawId], viewerId, limit: 1 });
  if (!post) return null;
  const useSource = post.sharedFromId && (type === 'vote' || !post.sharedCaption?.trim());
  if (!useSource) return post;
  const [source] = await loadVisiblePostScalars(tx, { ids: [post.sharedFromId], viewerId, limit: 1 });
  return source || null;
}
