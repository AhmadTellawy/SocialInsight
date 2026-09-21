import type { Comment, Survey, UserProfile } from '../types';

export function commentComposerIdentity(comments: Comment[], editingId: string | null,
  officialReply: boolean, pagePost?: Survey, user?: UserProfile) {
  if (editingId) {
    const find = (rows: Comment[]): Comment | undefined => {
      for (const comment of rows) {
        if (comment.id === editingId) return comment;
        const reply = comment.replies && find(comment.replies);
        if (reply) return reply;
      }
    };
    // An unavailable edit target must not silently switch to a human identity.
    return find(comments)?.author;
  }
  return officialReply && pagePost?.pageId ? pagePost.author : user;
}
