import React, { useEffect, useState } from 'react';
import { ArrowLeft, Hash, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PostAnswerPayload, Survey, UserProfile } from '../types';
import { api } from '../services/api';
import { SurveyCard } from './SurveyCard';
import { Analytics } from '../utils/analytics';

interface HashtagTopicScreenProps {
  name: string;
  userProfile?: UserProfile;
  contextGroups?: any[];
  onBack: () => void;
  onSurveyClick: (id: string, surface?: string) => void;
  onVote?: (surveyId: string, optionIds: string[], isAnonymous?: boolean, newOption?: any, followUpAnswers?: Record<string, string>, answers?: PostAnswerPayload[]) => void | boolean | Promise<void | boolean>;
  onSurveyProgress?: (surveyId: string, progress: any) => void;
  onAuthorClick?: (author: { id: string; name: string; avatar: string; handle?: string }) => void;
  onShareToFeed?: (survey: Survey, caption: string) => void;
  onUpdateDemographics?: (demographics: Partial<NonNullable<UserProfile['demographics']>>) => void;
  onGroupClick?: (groupId: string) => void;
  onLike?: (surveyId: string, isLiked: boolean) => void;
}

export const HashtagTopicScreen: React.FC<HashtagTopicScreenProps> = ({
  name,
  userProfile,
  contextGroups = [],
  onBack,
  onSurveyClick,
  onVote,
  onSurveyProgress,
  onAuthorClick,
  onShareToFeed,
  onUpdateDemographics,
  onGroupClick,
  onLike
}) => {
  const { i18n } = useTranslation();
  const isRtl = ['ar', 'ur'].includes(i18n.language?.split('-')[0]);
  const [sort, setSort] = useState<'top' | 'recent'>('top');
  const [posts, setPosts] = useState<Survey[]>([]);
  const [topic, setTopic] = useState<{ displayName: string; postCount: number }>({ displayName: name, postCount: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Analytics.track({
      event_type: 'HASHTAG_TOPIC_OPENED',
      source_surface: 'TOPIC'
    });
  }, [name]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);
    setPosts([]);
    setNextCursor(null);
    api.getHashtagPosts(name, sort)
      .then((result) => {
        if (!active) return;
        setTopic(result.topic);
        setPosts(result.data);
        setNextCursor(result.nextCursor);
      })
      .catch((requestError) => {
        console.error('Failed to load hashtag topic:', requestError);
        if (active) setError(isRtl ? 'تعذر تحميل الموضوع.' : 'Unable to load this topic.');
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [name, sort, isRtl]);

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const result = await api.getHashtagPosts(name, sort, nextCursor);
      setPosts((current) => [...current, ...result.data]);
      setNextCursor(result.nextCursor);
    } catch (requestError) {
      console.error('Failed to load more hashtag posts:', requestError);
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="min-h-full bg-white" dir={isRtl ? 'rtl' : 'ltr'}>
      <header className="sticky top-0 z-20 bg-white border-b border-gray-100">
        <div className="flex items-center gap-3 px-4 py-3">
          <button type="button" onClick={onBack} className="p-2 -m-2 text-gray-600 hover:bg-gray-50 rounded-full" aria-label={isRtl ? 'رجوع' : 'Back'}>
            <ArrowLeft size={22} className={isRtl ? 'rotate-180' : ''} />
          </button>
          <div className="min-w-0">
            <h1 className="font-black text-lg text-gray-900 truncate" dir="auto">#{topic.displayName}</h1>
            <p className="text-xs text-gray-500">{topic.postCount.toLocaleString()} {isRtl ? 'منشور' : 'posts'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 px-4" role="tablist" aria-label={isRtl ? 'ترتيب المنشورات' : 'Post order'}>
          {(['top', 'recent'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={sort === value}
              onClick={() => setSort(value)}
              className={`relative py-3 text-sm font-bold transition-colors ${sort === value ? 'text-blue-600' : 'text-gray-500'}`}
            >
              {value === 'top' ? (isRtl ? 'الأبرز' : 'Top') : (isRtl ? 'الأحدث' : 'Recent')}
              {sort === value && <span className="absolute inset-x-1/4 bottom-0 h-0.5 bg-blue-600 rounded-full" />}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 size={24} className="animate-spin" /></div>
      ) : error ? (
        <div className="px-6 py-20 text-center text-sm text-gray-500">{error}</div>
      ) : posts.length === 0 ? (
        <div className="px-6 py-20 text-center">
          <Hash size={28} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-bold text-gray-700">{isRtl ? 'لا توجد منشورات مرئية في هذا الموضوع بعد.' : 'No visible posts in this topic yet.'}</p>
        </div>
      ) : (
        <div>
          {posts.map((post, index) => (
            <SurveyCard
              key={post.id}
              survey={post}
              userProfile={userProfile}
              contextGroups={contextGroups}
              positionInFeed={index}
              sourceSurface="SEARCH"
              onContentClick={() => onSurveyClick(post.id, 'SEARCH')}
              onVote={onVote}
              onSurveyProgress={onSurveyProgress}
              onAuthorClick={onAuthorClick}
              onShareToFeed={onShareToFeed}
              onUpdateDemographics={onUpdateDemographics}
              onGroupClick={onGroupClick}
              onLike={onLike}
            />
          ))}
          {nextCursor && (
            <div className="px-4 py-5">
              <button
                type="button"
                onClick={loadMore}
                disabled={isLoadingMore}
                className="w-full py-3 text-sm font-bold text-blue-600 disabled:opacity-50"
              >
                {isLoadingMore ? (isRtl ? 'جارٍ التحميل...' : 'Loading...') : (isRtl ? 'عرض المزيد' : 'Load more')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
