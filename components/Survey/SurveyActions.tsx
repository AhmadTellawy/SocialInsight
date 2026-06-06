import React from 'react';
import { ThumbsUp, MessageCircle, Repeat, Share2, BarChart3 } from 'lucide-react';
import { formatCount } from '../../utils/formatters';

interface SurveyActionsProps {
  isLiked: boolean;
  likeCount: number;
  onLike: (e: React.MouseEvent) => void;
  onLikersClick: (e: React.MouseEvent) => void;
  
  allowComments: boolean;
  commentsCount: number;
  onCommentClick: (e: React.MouseEvent) => void;
  
  hasReposted: boolean;
  repostCount: number;
  onRepostClick: (e: React.MouseEvent) => void;
  
  onShareClick: (e: React.MouseEvent) => void;
  
  onAnalysisClick?: () => void;
}

export const SurveyActions: React.FC<SurveyActionsProps> = ({
  isLiked,
  likeCount,
  onLike,
  onLikersClick,
  
  allowComments,
  commentsCount,
  onCommentClick,
  
  hasReposted,
  repostCount,
  onRepostClick,
  
  onShareClick,
  
  onAnalysisClick
}) => {
  return (
    <div className="border-t border-gray-100 mt-1 px-1 py-2">
      <div className="flex items-center justify-between">
        {/* Like Button */}
        <div className="flex items-center justify-center min-w-[48px]">
          <div className={`flex items-center rounded-full transition-all ${isLiked ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}>
            <button onClick={onLike} className="p-2 rounded-full transition-transform active:scale-95 group" aria-label="Like" title="Like">
              <ThumbsUp size={18} fill={isLiked ? "currentColor" : "none"} strokeWidth={2} className={`transition-transform duration-300 ${isLiked ? 'scale-110' : 'group-hover:scale-110'}`} />
            </button>
            {likeCount > 0 && (
              <button onClick={onLikersClick} className={`text-[11px] pr-2 font-black ${isLiked ? 'text-blue-600' : 'text-gray-500'} hover:underline`} aria-label="View likes" title="View likes">
                {formatCount(likeCount)}
              </button>
            )}
          </div>
        </div>

        {/* Comment Button */}
        {allowComments && (
          <div className="flex items-center justify-center min-w-[48px]">
            <button onClick={onCommentClick} className="flex items-center gap-1 rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-all active:scale-95 group" aria-label="Comment" title="Comment">
              <MessageCircle size={18} strokeWidth={2} className="group-hover:scale-110 transition-transform" />
              {commentsCount > 0 && (
                <span className="text-[11px] font-black text-gray-500">
                  {formatCount(commentsCount)}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Repost Button */}
        <div className="flex items-center justify-center min-w-[48px]">
          <button onClick={onRepostClick} className={`flex items-center gap-1 rounded-full p-2 transition-all active:scale-95 group ${hasReposted ? 'text-green-600 bg-green-50' : 'text-gray-500 hover:bg-green-50 hover:text-green-600'}`} aria-label="Repost" title="Repost">
            <Repeat size={18} strokeWidth={2} className={`transition-transform ${hasReposted ? 'scale-110' : 'group-hover:scale-110'}`} />
            {repostCount > 0 && (
              <span className={`text-[11px] font-black ${hasReposted ? 'text-green-600' : 'text-gray-500'}`}>{formatCount(repostCount)}</span>
            )}
          </button>
        </div>

        {/* Share Button */}
        <div className="flex items-center justify-center min-w-[48px]">
          <button onClick={onShareClick} className="p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-all active:scale-95 group" aria-label="Share" title="Share">
            <Share2 size={18} strokeWidth={2} className="group-hover:scale-110 transition-transform" />
          </button>
        </div>

        {/* Analysis Button */}
        <div className="flex items-center justify-center min-w-[48px]">
          <button onClick={(e) => { e.stopPropagation(); onAnalysisClick && onAnalysisClick(); }} className="p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-all active:scale-95 group" aria-label="Analysis" title="Analysis">
            <BarChart3 size={18} strokeWidth={2} className="group-hover:scale-110 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
};
