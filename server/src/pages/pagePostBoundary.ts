import { Request, Response, NextFunction } from 'express';
import { arePublishedPostsVisible } from '../services/postVisibilitySql';
import { hasPostPageCapability, respondPagePostError } from './pagePostService';
import { PagePolicyError } from './pagePolicy';
import { pageTransaction } from './pageService';

/** Common Page boundary for every existing post route, including direct comment/tag links. */
export async function pagePostBoundary(req: Request, res: Response, next: NextFunction) {
  try {
    const parts = req.path.split('/').filter(Boolean);
    if (!parts.length || ['trends','drafts','saved'].includes(parts[0])) return next();
    // GET detail applies the full policy and source policy in one RepeatableRead
    // transaction. Do not run the same expensive query outside that snapshot.
    if (req.method === 'GET' && (parts.length === 1 || (parts.length === 2 && ['participants', 'comments', 'likes'].includes(parts[1]) && parts[0] !== 'comments'))) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      return next();
    }
    // These mutations perform their own canonical visibility check and then
    // revalidate under coordinated Page/Post locks. A separate boundary
    // transaction both consumes a pool slot and can observe stale state before
    // an already-queued lifecycle writer. Keep the controller transaction as
    // the single authoritative decision point.
    if (req.method === 'POST' && ['share', 'like', 'comments', 'vote'].includes(parts[1])) return next();
    await pageTransaction(async tx => {
      let postId = parts[0];
      if (parts[0] === 'comments') {
        const comment = await tx.comment.findUnique({where:{id:parts[1] || ''},select:{postId:true}});
        if (!comment) return;
        // A contributor may erase their own comment after the Page is hidden.
        // The controller rechecks current ownership in its deletion transaction.
        if (req.method === 'DELETE' && parts.length === 2) return;
        postId = comment.postId;
      } else if (parts[0] === 'people-tags') {
        const tag = await tx.postTaggedUser.findUnique({where:{id:parts[1] || ''},select:{postId:true,taggedUserId:true}});
        if (!tag) return;
        // Consent withdrawal exposes no Page content and stays recoverable when hidden.
        if (tag.taggedUserId === req.user?.userId && (req.method === 'DELETE' || (req.method === 'POST' && parts[2] === 'reject'))) return;
        postId = tag.postId;
      }
      const post = await tx.post.findUnique({where:{id:postId},select:{pageId:true,sharedFrom:{select:{pageId:true}}}});
      if (!post?.pageId && !post?.sharedFrom?.pageId) return;
      res.setHeader('Cache-Control','private, no-store');
      res.setHeader('Vary','Authorization');
      // Removing a private bookmark/hide does not expose the target and remains recoverable.
      if (req.method === 'DELETE' && ['save','hide'].includes(parts[1])) return;
      const manageOperation = parts.length === 1 && ['PUT','DELETE'].includes(req.method);
      if (post.pageId && manageOperation && await hasPostPageCapability(post.pageId,req.user?.userId,'manageContent',tx)) return;
      if (post.pageId && parts[0] === 'people-tags' && req.method === 'DELETE' && await hasPostPageCapability(post.pageId,req.user?.userId,'manageContent',tx)) return;
      if (!await arePublishedPostsVisible(tx,[postId],req.user?.userId)) {
        throw new PagePolicyError('PAGE_POST_UNAVAILABLE',404);
      }
    },'ReadCommitted');
    return next();
  } catch (error) {
    if (!respondPagePostError(error,res)) next(error);
  }
}
