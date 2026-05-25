import React from 'react';
import { ThumbsUp, MessageCircle, Repeat, Share2, BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();

  return (
    <div className="border-t border-gray-100 mt-2 px-1 pt-1 pb-1">
      <div className="flex items-center justify-between">
        {/* Like Button */}
        <div className="flex flex-col items-center justify-center min-w-[48px]">
          <div className="flex items-center gap-0.5">
            <button onClick={onLike} className={`p-1.5 rounded-full transition-transform active:scale-95 group ${isLiked ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}>
              <ThumbsUp size={16} fill={isLiked ? "currentColor" : "none"} strokeWidth={2} className={`transition-transform duration-300 ${isLiked ? 'scale-110' : 'group-hover:scale-110'}`} />
            </button>
            {likeCount > 0 && (
              <button onClick={onLikersClick} className={`text-[11px] pr-1 font-bold ${isLiked ? 'text-blue-600' : 'text-gray-500'} hover:underline`}>
                {formatCount(likeCount)}
              </button>
            )}
          </div>
          <span className={`text-[8px] uppercase tracking-widest font-bold mt-0.5 ${isLiked ? 'text-blue-600' : 'text-gray-400'}`}>{t('Like')}</span>
        </div>

        {/* Comment Button */}
        {allowComments && (
          <div className="flex flex-col items-center justify-center min-w-[48px]">
            <div className="flex items-center gap-0.5">
              <button onClick={onCommentClick} className="p-1.5 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-all active:scale-95 group">
                <MessageCircle size={16} strokeWidth={2} className="group-hover:scale-110 transition-transform" />
              </button>
              {commentsCount > 0 && (
                <button onClick={onCommentClick} className="text-[11px] pr-1 font-bold text-gray-500 hover:underline">
                  {formatCount(commentsCount)}
                </button>
              )}
            </div>
            <span className="text-[8px] uppercase tracking-widest font-bold mt-0.5 text-gray-400">{t('COMMENT')}</span>
          </div>
        )}

        {/* Repost Button */}
        <div className="flex flex-col items-center justify-center min-w-[48px]">
          <div className="flex items-center gap-0.5">
            <button onClick={onRepostClick} className={`p-1.5 rounded-full transition-all active:scale-95 group ${hasReposted ? 'text-green-600 bg-green-50' : 'text-gray-500 hover:bg-green-50 hover:text-green-600'}`}>
              <Repeat size={16} strokeWidth={2} className={`transition-transform ${hasReposted ? 'scale-110' : 'group-hover:scale-110'}`} />
            </button>
            {repostCount > 0 && (
              <span className={`text-[11px] pr-1 font-bold ${hasReposted ? 'text-green-600' : 'text-gray-500'}`}>{formatCount(repostCount)}</span>
            )}
          </div>
          <span className={`text-[8px] uppercase tracking-widest font-bold mt-0.5 ${hasReposted ? 'text-green-600' : 'text-gray-400 group-hover:text-green-600'}`}>{t('REPOST')}</span>
        </div>

        {/* Share Button */}
        <div className="flex flex-col items-center justify-center min-w-[48px]">
          <div className="flex items-center gap-0.5">
            <button onClick={onShareClick} className="p-1.5 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-all active:scale-95 group">
              <Share2 size={16} strokeWidth={2} className="group-hover:scale-110 transition-transform" />
            </button>
          </div>
          <span className="text-[8px] uppercase tracking-widest font-bold mt-0.5 text-gray-400">{t('SHARE')}</span>
        </div>

        {/* Analysis Button */}
        <div className="flex flex-col items-center justify-center min-w-[48px]">
          <div className="flex items-center gap-0.5">
            <button onClick={(e) => { e.stopPropagation(); onAnalysisClick && onAnalysisClick(); }} className="p-1.5 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-all active:scale-95 group">
              <BarChart3 size={16} strokeWidth={2} className="group-hover:scale-110 transition-transform" />
            </button>
          </div>
          <span className="text-[8px] uppercase tracking-widest font-bold mt-0.5 text-gray-400">{t('ANALYSIS')}</span>
        </div>
      </div>
    </div>
  );
};
