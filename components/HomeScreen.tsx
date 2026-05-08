import React, { useMemo, useState, useEffect } from 'react';
import { Activity } from 'lucide-react';
import { Survey, UserProfile } from '../types';
import { SurveyCard } from './SurveyCard';
import { SuggestedUsersList } from './SuggestedUsersList';
import { FollowerFeed } from './FollowerFeed';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';

interface HomeScreenProps {
  surveys: Survey[];
  userProfile: UserProfile;
  onSurveyClick: (id: string, sourceSurface?: 'FEED' | 'TRENDING') => void;
  onVote: (surveyId: string, optionIds: string[], newOption?: any) => void;
  onSurveyProgress: (surveyId: string, progress: any) => void;
  onAuthorClick: (author: { name: string; avatar: string }) => void;
  onShareToFeed: (survey: Survey, caption: string) => void;
  onUpdateDemographics: (demographics: Partial<NonNullable<UserProfile['demographics']>>) => void;
  onCloseShareSheet: () => void;
  contextGroups?: any[];
  onGroupClick?: (groupId: string) => void;
  onLike?: (surveyId: string, isLiked: boolean) => void;
  isLoading?: boolean;
  onLoadMore?: () => void;
  hasNextPage?: boolean;
  isLoadingMore?: boolean;
  onUpdateCurrentUser?: (user: UserProfile) => void;
}

export const SurveyCardSkeleton = () => (
  <div className="bg-white rounded-3xl p-4 mb-4 shadow-sm border border-gray-100 mx-4">
    <div className="animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-gray-200 rounded-full shrink-0" />
        <div className="flex-1">
          <div className="w-24 h-3 bg-gray-200 rounded-full mb-2" />
          <div className="w-16 h-2 bg-gray-100 rounded-full" />
        </div>
      </div>
      <div className="w-3/4 h-3 bg-gray-200 rounded-full mb-3" />
      <div className="w-1/2 h-3 bg-gray-100 rounded-full mb-6" />
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="w-full h-12 bg-gray-50 rounded-2xl border border-gray-100" />
        ))}
      </div>
    </div>
  </div>
);

export const TrendingSkeleton = () => (
  <div className="min-w-[130px] w-[130px] aspect-[4/5] rounded-[2rem] bg-gray-100 animate-pulse border border-gray-50 shrink-0" />
);

export const HomeScreen: React.FC<HomeScreenProps> = ({
  surveys,
  userProfile,
  onSurveyClick,
  onVote,
  onSurveyProgress,
  onAuthorClick,
  onShareToFeed,
  onUpdateDemographics,
  onCloseShareSheet,
  contextGroups = [],
  onGroupClick,
  onLike,
  isLoading,
  onLoadMore,
  hasNextPage,
  isLoadingMore,
  onUpdateCurrentUser
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'fyp' | 'following'>('fyp');

  const { trendingSurveys, regularSurveys } = useMemo(() => {
    const trending: Survey[] = [];
    const regular: Survey[] = [];
    for (let i = 0; i < surveys.length; i++) {
      const s = surveys[i];
      if (s.isTrending && trending.length < 6) {
        trending.push(s);
      } else if (!s.isTrending) {
        regular.push(s);
      }
    }
    return { trendingSurveys: trending, regularSurveys: regular };
  }, [surveys]);

  const [suggestedUsers, setSuggestedUsers] = useState<any[]>([]);
  const [isSuggestedLoading, setIsSuggestedLoading] = useState(true);

  useEffect(() => {
    if (userProfile && userProfile.id && !userProfile.isGuest) {
      if (suggestedUsers.length === 0) {
        setIsSuggestedLoading(true);
        api.getSuggestedUsers(userProfile.id)
          .then(setSuggestedUsers)
          .catch(console.error)
          .finally(() => setIsSuggestedLoading(false));
      } else {
        setIsSuggestedLoading(false);
      }
    } else {
      setIsSuggestedLoading(false);
    }
  }, [userProfile?.id]);

  const handleFollowSuggestion = async (targetId: string) => {
    if (!userProfile) return;
    try {
      // Optimistically dispatch follow event for the rest of the app
      window.dispatchEvent(new CustomEvent('onFollowStateChange', {
        detail: { targetUserId: targetId, isFollowing: true }
      }));
      
      // Delay removal so the "Following" animation can complete smoothly
      setTimeout(() => {
          setSuggestedUsers(prev => prev.filter(u => u.id !== targetId));
      }, 800);

      // Perform request in background without blocking UI
      api.followUser(targetId, userProfile.id).catch(console.error);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDismissSuggestion = (targetId: string) => {
    setSuggestedUsers(prev => prev.filter(u => u.id !== targetId));
  };

  if (isLoading && surveys.length === 0) {
    return (
      <div className="pb-20 animate-in fade-in duration-500 bg-white">
        <div className="py-6 pt-4">
            <div className="px-5 flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-32 h-4 bg-gray-200 rounded-full animate-pulse" />
              </div>
            </div>
            <div className="flex gap-4 overflow-x-auto px-4 pb-2 no-scrollbar">
               {[1,2,3,4].map(i => <TrendingSkeleton key={i} />)}
            </div>
        </div>
        <div className="space-y-1 mt-2">
           {[1,2,3].map(i => <SurveyCardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="pb-20 animate-in fade-in duration-500">
      {/* 1. Trending Stories / Highlights */}
      <div className="py-6 pt-4">
        <div className="px-5 flex items-center justify-between mb-4">
          <div className="flex items-center gap-2" aria-hidden="true">
            <div className="w-1.5 h-6 bg-red-500 rounded-full" />
            <h3 className="font-black text-gray-900 uppercase tracking-tight text-sm">{t('TRENDING NOW')}</h3>
          </div>
          <button type="button" className="text-xs font-bold text-blue-600 flex items-center gap-0.5" aria-label="Live Now">
            {t('Live')} <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse ml-1" aria-hidden="true" />
          </button>
        </div>

        <div className="flex gap-4 overflow-x-auto px-4 pb-2 no-scrollbar">
          {trendingSurveys.map((survey, i) => (
            <button
              key={survey.id}
              type="button"
              onClick={() => onSurveyClick(survey.id, 'TRENDING')}
              aria-label={`Open trending: ${survey.title}`}
              className="relative min-w-[130px] w-[130px] aspect-[4/5] rounded-[2rem] overflow-hidden shadow-md active:scale-95 transition-all cursor-pointer group text-left"
            >
              <img
                src={survey.coverImage || 'https://images.unsplash.com/photo-1557683316-973673baf926?auto=format&fit=crop&q=80&w=400'}
                alt=""
                data-fallback-applied="false"
                onError={(e) => {
                  if (e.currentTarget.getAttribute('data-fallback-applied') !== 'true') {
                    e.currentTarget.setAttribute('data-fallback-applied', 'true');
                    e.currentTarget.src = 'https://images.unsplash.com/photo-1557683316-973673baf926?auto=format&fit=crop&q=80&w=400';
                  }
                }}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" aria-hidden="true" />

              <div className="absolute top-3 left-3 flex -space-x-2" aria-hidden="true">
                <img
                  src={survey.author?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${survey.author?.name || 'user'}`}
                  className="w-8 h-8 rounded-full border-2 border-white shadow-sm"
                  alt=""
                  data-fallback-applied="false"
                  onError={(e) => {
                    if (e.currentTarget.getAttribute('data-fallback-applied') !== 'true') {
                      e.currentTarget.setAttribute('data-fallback-applied', 'true');
                      e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${survey.author?.name || 'user'}`;
                    }
                  }}
                />
                {i % 2 === 0 && <div className="w-8 h-8 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center text-[10px] text-white font-bold">+12</div>}
              </div>

              <div className="absolute bottom-4 left-3 right-3">
                <p className="text-[11px] font-bold text-white line-clamp-2 leading-tight">
                  {survey.title}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Suggested Users (Top) */}
      {isSuggestedLoading ? (
          <div className="mb-2 bg-white border-b border-gray-100 py-4">
              <div className="px-4 mb-4 flex items-center justify-between">
                  <div className="w-32 h-4 bg-gray-200 rounded-full animate-pulse" />
              </div>
              <div className="flex gap-3 overflow-x-hidden px-4 pb-4">
                  {[1, 2, 3].map(i => (
                      <div key={i} className="flex-none w-[140px] h-[216px] border border-gray-100 rounded-2xl p-4 flex flex-col items-center justify-center animate-pulse">
                          <div className="w-[72px] h-[72px] bg-gray-200 rounded-full mb-3" />
                          <div className="w-20 h-3 bg-gray-200 rounded-full mb-2" />
                          <div className="w-16 h-2 bg-gray-100 rounded-full mb-4" />
                          <div className="w-full h-8 bg-gray-100 rounded-full" />
                      </div>
                  ))}
              </div>
          </div>
      ) : suggestedUsers.length > 0 ? (
          <div className="mb-2">
            <SuggestedUsersList users={suggestedUsers} onFollow={handleFollowSuggestion} onDismiss={handleDismissSuggestion} onUserClick={onAuthorClick} />
          </div>
      ) : null}

      {/* 3. Main Feed */}
      <div className="space-y-1">
        {regularSurveys.map((survey, index) => (
          <React.Fragment key={survey.id}>
            <SurveyCard
              survey={survey}
              userProfile={userProfile}
              onContentClick={() => onSurveyClick(survey.id, 'FEED')}
              onAnalysisClick={() => onSurveyClick(survey.id, 'FEED', 'analysis')}
              onVote={onVote}
              onSurveyProgress={onSurveyProgress}
              onAuthorClick={onAuthorClick}
              onShareToFeed={onShareToFeed}
              onUpdateDemographics={onUpdateDemographics}
              onCloseShareSheet={onCloseShareSheet}
              positionInFeed={index}
              contextGroups={contextGroups}
              onGroupClick={onGroupClick}
              sourceSurface="FEED"
              onLike={onLike}
            />
          </React.Fragment>
        ))}
      </div>

      {/* 4. Footer Loading Indicator */}
      <div className="py-8 flex flex-col items-center justify-center min-h-[120px] transition-all">
        {isLoadingMore ? (
            <div className="flex flex-col items-center animate-pulse opacity-50">
                <Activity size={32} className="text-gray-400 mb-3 animate-spin-slow" />
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t('Loading More...')}</p>
            </div>
        ) : !hasNextPage ? (
            <div className="flex flex-col items-center opacity-20">
                <Activity size={32} className="text-gray-400 mb-3" />
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t("You've reached the end")}</p>
            </div>
        ) : (
            <div className="flex flex-col items-center opacity-0">
                <Activity size={32} className="mb-3" />
                <p className="text-[10px] font-black uppercase tracking-widest">Spacer</p>
            </div>
        )}
      </div>
    </div>
  );
};
