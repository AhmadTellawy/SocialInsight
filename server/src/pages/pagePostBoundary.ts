import { Request, Response, NextFunction } from 'express';
import prisma from '../prisma';
import { arePublishedPostsVisible } from '../services/postVisibilitySql';
import { hasPostPageCapability, respondPagePostError } from './pagePostService';
import { PagePolicyError } from './pagePolicy';

/** Common Page boundary for every existing post route, including direct comment/tag links. */
export async function pagePostBoundary(req: Request, res: Response, next: NextFunction) {
  try {
    const parts = req.path.split('/').filter(Boolean);
    if (!parts.length || ['trends','drafts','saved'].includes(parts[0])) return next();
    // GET detail applies the full policy and source policy in one RepeatableRead
    // transaction. Do not run the same expensive query outside that snapshot.
    if (req.method === 'GET' && parts.length === 1) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      return next();
    }
    let postId = parts[0];
    if (parts[0] === 'comments') {
      const comment = await prisma.comment.findUnique({where:{id:parts[1] || ''},select:{postId:true}});
      if (!comment) return next();
      postId = comment.postId;
    } else if (parts[0] === 'people-tags') {
      const tag = await prisma.postTaggedUser.findUnique({where:{id:parts[1] || ''},select:{postId:true,taggedUserId:true}});
      if (!tag) return next();
      // Consent withdrawal exposes no Page content and stays recoverable when hidden.
      if (tag.taggedUserId === req.user?.userId && (req.method === 'DELETE' || (req.method === 'POST' && parts[2] === 'reject'))) return next();
      postId = tag.postId;
    }
    const post = await prisma.post.findUnique({where:{id:postId},select:{pageId:true,sharedFrom:{select:{pageId:true}}}});
    if (!post?.pageId && !post?.sharedFrom?.pageId) return next();
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Authorization');
    // Removing a private bookmark/hide does not expose the target and remains recoverable.
    if (req.method === 'DELETE' && ['save','hide'].includes(parts[1])) return next();
    const manageOperation = parts.length === 1 && ['PUT','DELETE'].includes(req.method);
    if (post.pageId && manageOperation && await hasPostPageCapability(post.pageId,req.user?.userId,'manageContent')) return next();
    if (post.pageId && parts[0] === 'people-tags' && req.method === 'DELETE' && await hasPostPageCapability(post.pageId,req.user?.userId,'manageContent')) return next();
    if (!await arePublishedPostsVisible(prisma,[postId],req.user?.userId)) {
      throw new PagePolicyError('PAGE_POST_UNAVAILABLE',404);
    }
    return next();
  } catch (error) {
    if (!respondPagePostError(error,res)) next(error);
  }
}
