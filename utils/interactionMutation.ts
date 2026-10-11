import type { Comment, Survey } from '../types';

export function updateComment(comments: Comment[], id: string, update: (comment: Comment) => Comment): Comment[] {
  return comments.map(comment => comment.id === id ? update(comment) : comment.replies
    ? { ...comment, replies: updateComment(comment.replies, id, update) } : comment);
}

export function updatePost(post: Survey, id: string, update: (post: Survey) => Survey): Survey {
  if (post.id === id) return update(post);
  return post.sharedFrom?.id === id ? { ...post, sharedFrom: update(post.sharedFrom) } : post;
}

/** Roll back only vote-owned fields; preserve concurrent likes, comments and other posts. */
export function restoreVote(current: Survey, before: Survey): Survey {
  return { ...current, options: before.options, questions: before.questions, sections: before.sections,
    hasParticipated: before.hasParticipated, userSelectedOptions: before.userSelectedOptions,
    participants: before.participants, userProgress: before.userProgress };
}
