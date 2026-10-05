import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, ThumbsUp, Reply, Edit2, Trash2, X, Loader2 } from 'lucide-react';
import { Analytics } from '../utils/analytics';
import { Comment, UserProfile } from '../types';
import { useCommentThread } from '../hooks/useCommentThread';
import { interactionGeneration } from '../utils/interactionCache';
import { LikersSheet } from './LikersSheet';
import { RichMentionInput } from './RichMentionInput';
import { RichTextRenderer } from './RichTextRenderer';
import { UserAvatar } from './UserAvatar';

interface CommentsSheetProps {
  surveyId: string;
  userProfile?: UserProfile;
  onAuthorClick?: (author: { name: string; avatar: string }) => void;
  sourceSurface?: 'FEED' | 'PROFILE' | 'SAVED' | 'SEARCH' | 'DEEP_LINK';
  initialCount?: number;
  initialCommentId?: string;
  initialReplyId?: string;
}

const formatRelativeTime = (dateString: string) => {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString; // fallback
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d ago`;
  const diffInWeeks = Math.floor(diffInDays / 7);
  if (diffInDays < 30) return `${diffInWeeks}w ago`;
  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) return `${diffInMonths}mo ago`;
  return `${Math.floor(diffInDays / 365)}y ago`;
};

interface CommentItemProps {
  comment: Comment;
  isReply?: boolean;
  parentId?: string;
  onLike: (id: string, isReply?: boolean, parentId?: string) => void;
  onLikersClick: (id: string) => void;
  onReply: (id: string) => void;
  onAuthorClick?: (author: { name: string; avatar: string }) => void;
  onLongPress?: (comment: Comment, isReply: boolean, parentId?: string) => void;
  highlightedCommentId?: string | null;
}

const CommentItem: React.FC<CommentItemProps> = ({ comment, isReply = false, parentId, onLike, onLikersClick, onReply, onAuthorClick, onLongPress, highlightedCommentId }) => {
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);

  const handlePressStart = () => {
    if (!onLongPress) return;
    timerRef.current = setTimeout(() => {
      onLongPress(comment, isReply, parentId);
    }, 500); // 500ms long press
  };

  const handlePressEnd = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  return (
  <div
    id={`comment-${comment.id}`}
    data-comment-id={comment.id}
    className={`flex gap-3 mb-4 rounded-xl transition-colors duration-500 ${isReply ? 'ml-11 mt-2' : ''} ${highlightedCommentId === comment.id ? 'bg-blue-50 ring-2 ring-blue-200' : ''}`}
  >
    <button type="button" onClick={() => onAuthorClick && onAuthorClick(comment.author)} className="shrink-0 cursor-pointer hover:opacity-80" aria-label={comment.author.name}>
      <UserAvatar src={comment.author.avatar} mediaId={comment.author.avatarMediaId} media={comment.author.avatarMedia} name={comment.author.name} alt={comment.author.name} size={32} className="select-none" />
    </button>
    <div className="flex-1">
      <div 
        className="bg-gray-100 rounded-2xl px-3 py-2 inline-block transition-colors active:bg-gray-200 select-none cursor-pointer"
        onMouseDown={handlePressStart}
        onMouseUp={handlePressEnd}
        onMouseLeave={handlePressEnd}
        onTouchStart={handlePressStart}
        onTouchEnd={handlePressEnd}
        onTouchMove={handlePressEnd}
        onContextMenu={(e) => { e.preventDefault(); if (onLongPress) onLongPress(comment, isReply, parentId); }}
      >
        <div className="flex items-center gap-2 mb-0.5 pointer-events-none">
          <span
            className="text-sm font-bold text-gray-900 cursor-pointer hover:underline"
            onClick={() => onAuthorClick && onAuthorClick(comment.author)}
          >
            {comment.author.name}
          </span>
          <span className="text-xs text-gray-500">{formatRelativeTime(comment.timestamp)}</span>
        </div>
        <p className="text-sm text-gray-800 leading-relaxed">
          <RichTextRenderer text={comment.text} mentions={comment.mentions} mentionSurface="COMMENT_TEXT" />
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4 mt-1 ml-2">
        <div className="flex items-center">
          <button
            onClick={() => onLike(comment.id, isReply, parentId)}
            className={`text-xs font-semibold flex items-center gap-1 transition-colors ${comment.isLiked ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {comment.isLiked ? <ThumbsUp size={12} fill="currentColor" /> : 'Like'}
          </button>
          {comment.likes > 0 && (
            <button
              onClick={() => onLikersClick(comment.id)}
              className="ml-1 px-1.5 py-0.5 rounded hover:bg-gray-200 text-xs font-semibold text-gray-500 hover:text-blue-600 transition-colors"
            >
              {comment.likes}
            </button>
          )}
        </div>

        {!isReply && (
          <button
            onClick={() => onReply(comment.id)}
            className="text-xs font-semibold text-gray-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
          >
            Reply
          </button>
        )}
      </div>

      {/* Nested Replies */}
      {comment.replies && comment.replies.map(reply => (
        <CommentItem
          key={reply.id}
          comment={reply}
          isReply={true}
          parentId={comment.id}
          onLike={onLike}
          onLikersClick={onLikersClick}
          onReply={onReply}
          onAuthorClick={onAuthorClick}
          onLongPress={onLongPress}
          highlightedCommentId={highlightedCommentId}
        />
      ))}
    </div>

  </div>
  );
};

import { api, ApiError } from '../services/api';

// ... imports

export const CommentsSheet: React.FC<CommentsSheetProps> = ({ surveyId, userProfile, onAuthorClick, sourceSurface = 'FEED', initialCount = 0, initialCommentId, initialReplyId }) => {
  const { t } = useTranslation();
  const { comments, setComments, isLoading, isLoadingMore, nextCursor, loadError, loadCommentsPage } = useCommentThread(userProfile?.id, surveyId, initialCount, initialReplyId || initialCommentId);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);
  const composerRef = React.useRef<HTMLDivElement>(null);
  const focusComposer = () => composerRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [isLikersSheetOpen, setIsLikersSheetOpen] = useState(false);
  const [likersTargetId, setLikersTargetId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = React.useRef(false);


  // Comment Actions State
  const [actionSheetComment, setActionSheetComment] = useState<{ comment: Comment, isReply: boolean, parentId?: string } | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null);

  React.useEffect(() => {
    const targetId = initialReplyId || initialCommentId;
    if (isLoading || !targetId) return;

    const scrollTimer = window.setTimeout(() => {
      const target = document.getElementById(`comment-${targetId}`);
      if (!target) return;
      setHighlightedCommentId(targetId);
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    const clearTimer = window.setTimeout(() => setHighlightedCommentId(null), 2600);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [isLoading, initialCommentId, initialReplyId, comments]);

  const handleLike = async (commentId: string, isReply = false, parentId?: string) => {
    if (!userProfile?.id) return;
    try {
      // Optimistic update
      if (isReply && parentId) {
        setComments(prev => prev.map(c => {
          if (c.id === parentId && c.replies) {
            return {
              ...c,
              replies: c.replies.map(r => r.id === commentId ? { ...r, likes: r.isLiked ? r.likes - 1 : r.likes + 1, isLiked: !r.isLiked } : r)
            };
          }
          return c;
        }));
      } else {
        setComments(prev => prev.map(c => c.id === commentId ? { ...c, likes: c.isLiked ? c.likes - 1 : c.likes + 1, isLiked: !c.isLiked } : c));
      }

      await api.likeComment(commentId);
    } catch (e) {
      console.error("Failed to like comment", e);
      // Revert optimistic update on failure could be added here
    }
  };


  const handleSend = async () => {
    if (isSubmittingRef.current || !newComment.trim()) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSendError(null);
    setSendSuccess(false);
    const epoch = interactionGeneration();

    try {
      if (editingCommentId) {
        // Handle Edit Update
        const updatedRaw = await api.updateComment(editingCommentId, newComment);
        if (epoch !== interactionGeneration()) return;
        setComments(prev => {
          // It could be a reply or a top level comment
          // To safely update, we recursively map or just check both levels
          return prev.map(c => {
            if (c.id === editingCommentId) {
              return { ...c, ...updatedRaw };
            }
            if (c.replies) {
              return {
                ...c,
                replies: c.replies.map(r => r.id === editingCommentId ? { ...r, ...updatedRaw } : r)
              };
            }
            return c;
          });
        });
        setNewComment('');
        setEditingCommentId(null);
      } else {
        // Handle New Comment
        const createdComment = await api.createComment(surveyId, newComment, replyingTo || undefined);

        if (epoch !== interactionGeneration()) return;
        if (replyingTo) {
          setComments(prev => prev.map(c => {
            if (c.id === replyingTo) {
              return { ...c, replies: [...(c.replies || []), createdComment] };
            }
            return c;
          }), 1, createdComment.commentsCount);
          setReplyingTo(null);
        } else {
          setComments(prev => [createdComment, ...prev], 1, createdComment.commentsCount);
        }
        setNewComment('');

        Analytics.track({
          event_type: 'COMMENT_CREATE',
          post_id: surveyId,
          comment_id: createdComment.id,
          actor_user_id: userProfile?.id,
          source_surface: sourceSurface
        });
      }
      setSendSuccess(true);
    } catch (error) {
      if (epoch !== interactionGeneration()) return;
      if (error instanceof ApiError && error.code === 'MENTION_LIMIT_EXCEEDED') {
        setSendError(t('mentions.limitExceeded', { limit: error.details?.limit }));
      } else {
        setSendError(editingCommentId ? t("commentsState.editFailed") : t("commentsState.sendFailed"));
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      {/* Scrollable Comments List */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-4 overscroll-contain no-scrollbar">
        {isLoading ? (
          <div className="space-y-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-gray-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="bg-gray-100 rounded-2xl w-full h-16" />
                  <div className="flex gap-4 ml-2">
                     <div className="w-8 h-3 bg-gray-200 rounded" />
                     <div className="w-12 h-3 bg-gray-200 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : loadError && comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center text-gray-500">
            <p className="text-sm mb-3">{loadError}</p>
            <button onClick={() => void loadCommentsPage(null, false)} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold">Retry</button>
          </div>
        ) : comments.length === 0 && !isSubmitting ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400">
            <p>No comments yet. Be the first!</p>
          </div>
        ) : (
          <>
            {comments.map(comment => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onLike={handleLike}
                onLikersClick={(id) => {
                  setLikersTargetId(id);
                  setIsLikersSheetOpen(true);
                }}
                onReply={(id) => { setReplyingTo(id); focusComposer(); }}
                onAuthorClick={onAuthorClick}
                onLongPress={(comment, isReply, parentId) => {
                  if (userProfile?.id === comment.author.id) {
                    setActionSheetComment({ comment, isReply, parentId });
                  }
                }}
                highlightedCommentId={highlightedCommentId}
              />
            ))}
            {nextCursor && (
              <button
                onClick={() => void loadCommentsPage(nextCursor, true)}
                disabled={isLoadingMore}
                className="mx-auto my-5 flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600 disabled:opacity-60"
              >
                {isLoadingMore && <Loader2 size={14} className="animate-spin" />}
                Load more comments
              </button>
            )}
          </>
        )}
      </div>

      {isSubmitting && <div role="status" className="shrink-0 px-4 py-2 text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />{t('commentsState.sending')}</div>}
      {sendError && <p role="alert" className="shrink-0 px-4 py-2 text-sm text-red-600">{sendError}</p>}
      {sendSuccess && !isSubmitting && <p role="status" className="sr-only">{t('commentsState.sent')}</p>}
      {/* Composer occupies layout space and remains inside the visual viewport. */}
      <div ref={composerRef} className="shrink-0 bg-white border-t border-gray-100 p-3 pb-safe z-10 shadow-[0_-5px_15px_rgba(0,0,0,0.02)]">
        {replyingTo && (
          <div className="flex items-center justify-between bg-gray-50 px-3 py-1.5 rounded-lg mb-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Reply size={12} /> Replying to {comments.find(c => c.id === replyingTo)?.author.name}</span>
            <button onClick={() => setReplyingTo(null)} className="font-bold text-gray-400 hover:text-gray-600">Cancel</button>
          </div>
        )}
        <div className="flex items-center gap-3">
          <UserAvatar src={userProfile?.avatar} mediaId={userProfile?.avatarMediaId} media={userProfile?.avatarMedia} name={userProfile?.name} alt="You" size={32} className="border border-gray-200" />
          <div className="flex-1 flex items-center bg-gray-100 rounded-2xl px-4 py-2 transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 border border-transparent focus-within:border-blue-200">
            <RichMentionInput
              value={newComment}
              onChange={(val) => { if (!isSubmitting) { setNewComment(val); setSendSuccess(false); } }}
              disabled={isSubmitting}
              placeholder={editingCommentId ? "Edit your comment..." : (replyingTo ? "Write a reply..." : "Write a comment...")}
              className="flex-1 bg-transparent text-sm focus:outline-none placeholder-gray-500"
              minRows={1}
              onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!isSubmitting) {
                          handleSend();
                      }
                  }
              }}
            />
            <button
              aria-label={t("commentsState.send")}
              onClick={handleSend}
              disabled={!newComment.trim() || isSubmitting}
              className={`ml-2 p-1.5 rounded-full transition-all ${newComment.trim() && !isSubmitting ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400'}`}
            >
              {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} className={newComment.trim() ? "translate-x-0.5" : ""} />}
            </button>
          </div>
        </div>
      </div>

      <LikersSheet
        isOpen={isLikersSheetOpen}
        onClose={() => setIsLikersSheetOpen(false)}
        targetId={likersTargetId}
        type="comment"
        onAuthorClick={onAuthorClick}
        currentUser={userProfile}
        isLikedLocally={
          comments.find(c => c.id === likersTargetId)?.isLiked || 
          comments.flatMap(c => c.replies || []).find(r => r.id === likersTargetId)?.isLiked
        }
      />

      {/* Action Sheet for Edit/Delete */}
      {actionSheetComment && (
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-end animate-in fade-in duration-200" onClick={() => setActionSheetComment(null)}>
          <div className="bg-white w-full rounded-t-3xl p-6 pb-safe animate-in slide-in-from-bottom flex flex-col gap-2" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold text-gray-900 text-lg">Comment Options</h3>
              <button onClick={() => setActionSheetComment(null)} className="p-2 bg-gray-100 rounded-full text-gray-500 hover:bg-gray-200">
                <X size={20} />
              </button>
            </div>

            <button
              onClick={() => {
                setEditingCommentId(actionSheetComment.comment.id);
                setNewComment(actionSheetComment.comment.text);
                setActionSheetComment(null);
                focusComposer();
              }}
              className="flex items-center gap-4 p-4 hover:bg-gray-50 rounded-xl transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <Edit2 size={20} />
              </div>
              <div>
                <h4 className="font-semibold text-gray-900">Edit Comment</h4>
                <p className="text-sm text-gray-500">Modify your comment text</p>
              </div>
            </button>

            <button
              onClick={async () => {
                if (window.confirm("Are you sure you want to delete this comment?")) {
                  try {
                    const epoch = interactionGeneration();
                    const deleted = await api.deleteComment(actionSheetComment.comment.id);
                    if (epoch !== interactionGeneration()) return;
                    setComments(prev => {
                      if (actionSheetComment.isReply && actionSheetComment.parentId) {
                        return prev.map(c => c.id === actionSheetComment.parentId ? { ...c, replies: c.replies?.filter(r => r.id !== actionSheetComment.comment.id) } : c);
                      }
                      return prev.filter(c => c.id !== actionSheetComment.comment.id);
                    }, -(1 + (actionSheetComment.comment.replies?.length || 0)), deleted.commentsCount);
                    setActionSheetComment(null);
                  } catch (err) {
                    console.error("Failed to delete comment", err);
                    alert("Failed to delete comment");
                  }
                }
              }}
              className="flex items-center gap-4 p-4 hover:bg-red-50 rounded-xl transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                <Trash2 size={20} />
              </div>
              <div>
                <h4 className="font-semibold text-gray-900">Delete Comment</h4>
                <p className="text-sm text-gray-500">Remove this comment permanently</p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
