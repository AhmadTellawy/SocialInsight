import React, { useState } from 'react';
import { Send, ThumbsUp, Reply, User as UserIcon } from 'lucide-react';
import { Analytics } from '../utils/analytics';
import { Comment, UserProfile } from '../types';
import { MOCK_COMMENTS } from '../services/mockData';
import { LikersSheet } from './LikersSheet';
import { RichMentionInput } from './RichMentionInput';
import { RichTextRenderer } from './RichTextRenderer';

interface CommentsSheetProps {
  surveyId: string;
  userProfile?: UserProfile;
  onAuthorClick?: (author: { name: string; avatar: string }) => void;
  sourceSurface?: 'FEED' | 'PROFILE' | 'SAVED' | 'SEARCH' | 'DEEP_LINK';
  onCommentAdded?: () => void;
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
  if (diffInWeeks < 4) return `${diffInWeeks}w ago`;
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
}

const CommentItem: React.FC<CommentItemProps> = ({ comment, isReply = false, parentId, onLike, onLikersClick, onReply, onAuthorClick }) => (
  <div className={`flex gap-3 mb-4 ${isReply ? 'ml-11 mt-2' : ''}`}>
    <img
      src={comment.author.avatar}
      alt={comment.author.name}
      className="w-8 h-8 rounded-full object-cover shrink-0 cursor-pointer hover:opacity-80"
      onClick={() => onAuthorClick && onAuthorClick(comment.author)}
    />
    <div className="flex-1">
      <div className="bg-gray-100 rounded-2xl px-3 py-2 inline-block">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className="text-sm font-bold text-gray-900 cursor-pointer hover:underline"
            onClick={() => onAuthorClick && onAuthorClick(comment.author)}
          >
            {comment.author.name}
          </span>
          <span className="text-xs text-gray-500">{formatRelativeTime(comment.timestamp)}</span>
        </div>
        <p className="text-sm text-gray-800 leading-relaxed"><RichTextRenderer text={comment.text} /></p>
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
        />
      ))}
    </div>

  </div>
);

import { api } from '../services/api';

// ... imports

export const CommentsSheet: React.FC<CommentsSheetProps> = ({ surveyId, userProfile, onAuthorClick, sourceSurface = 'FEED', onCommentAdded }) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [isLikersSheetOpen, setIsLikersSheetOpen] = useState(false);
  const [likersTargetId, setLikersTargetId] = useState<string>('');

  React.useEffect(() => {
    const loadComments = async () => {
      try {
        const data = await api.getComments(surveyId, userProfile?.id);
        setComments(data);
      } catch (e) {
        console.error("Failed to load comments", e);
        alert("Failed to load comments. Please try again.");
      }
    };
    loadComments();
  }, [surveyId, userProfile?.id]);

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

      await api.likeComment(commentId, userProfile.id);
    } catch (e) {
      console.error("Failed to like comment", e);
      // Revert optimistic update on failure could be added here
    }
  };

  const handleSend = async () => {
    if (!newComment.trim()) return;

    try {
      console.log("Sending comment:", newComment);
      const createdComment = await api.createComment(surveyId, newComment, replyingTo || undefined, userProfile?.id);

      if (replyingTo) {
        setComments(prev => prev.map(c => {
          if (c.id === replyingTo) {
            return { ...c, replies: [...(c.replies || []), createdComment] };
          }
          return c;
        }));
        setReplyingTo(null);
      } else {
        setComments(prev => [createdComment, ...prev]);
      }
      setNewComment('');
      if (onCommentAdded) onCommentAdded();
      Analytics.track({
        event_type: 'COMMENT_CREATE',
        post_id: surveyId,
        comment_id: createdComment.id,
        actor_user_id: userProfile?.id,
        source_surface: sourceSurface
      });
    } catch (error) {
      console.error("Failed to send comment", error);
      alert("Failed to send the comment. Please try again.");
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Scrollable Comments List */}
      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-20 overscroll-contain no-scrollbar">
        {comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400">
            <p>No comments yet. Be the first!</p>
          </div>
        ) : (
          comments.map(comment => (
            <CommentItem
              key={comment.id}
              comment={comment}
              onLike={handleLike}
              onLikersClick={(id) => {
                setLikersTargetId(id);
                setIsLikersSheetOpen(true);
              }}
              onReply={setReplyingTo}
              onAuthorClick={onAuthorClick}
            />
          ))
        )}
      </div>

      {/* Fixed Input Area */}
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-3 pb-safe z-10 shadow-[0_-5px_15px_rgba(0,0,0,0.02)]">
        {replyingTo && (
          <div className="flex items-center justify-between bg-gray-50 px-3 py-1.5 rounded-lg mb-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Reply size={12} /> Replying to {comments.find(c => c.id === replyingTo)?.author.name}</span>
            <button onClick={() => setReplyingTo(null)} className="font-bold text-gray-400 hover:text-gray-600">Cancel</button>
          </div>
        )}
        <div className="flex items-center gap-3">
          {userProfile?.avatar ? (
            <img src={userProfile.avatar} alt="You" className="w-8 h-8 rounded-full border border-gray-200 object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full border border-gray-200 bg-gray-100 flex items-center justify-center">
              <UserIcon size={16} className="text-gray-400" strokeWidth={2} />
            </div>
          )}
          <div className="flex-1 flex items-center bg-gray-100 rounded-2xl px-4 py-2 transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 border border-transparent focus-within:border-blue-200">
            <RichMentionInput
              value={newComment}
              onChange={(val) => setNewComment(val)}
              placeholder={replyingTo ? "Write a reply..." : "Write a comment..."}
              className="flex-1 bg-transparent text-sm focus:outline-none placeholder-gray-500"
              minRows={1}
              onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                  }
              }}
            />
            <button
              onClick={handleSend}
              disabled={!newComment.trim()}
              className={`ml-2 p-1.5 rounded-full transition-all ${newComment.trim() ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400'}`}
            >
              <Send size={14} className={newComment.trim() ? "translate-x-0.5" : ""} />
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
      />
    </div>
  );
};