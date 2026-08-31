import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Search, X, Clock, TrendingUp, ChevronRight, User, Users, 
  FileText, PieChart, Hash, ArrowLeft, Shield, Lock, Globe, 
  Trophy, Sparkles, Flame, HelpCircle 
} from 'lucide-react';
import { Survey, SurveyType } from '../types';
import { UserAvatar } from './UserAvatar';
import { api } from '../services/api';
import { MediaImage } from './media/MediaImage';
import { useNavigate } from 'react-router-dom';
import { Analytics } from '../utils/analytics';

interface SearchScreenProps {
  surveys: Survey[]; // Kept for interface compatibility or fallback
  onSurveyClick: (id: string, surface?: string) => void;
  onAuthorClick?: (author: { id: string; name: string; avatar: string; handle?: string }) => void;
  onGroupClick?: (groupId: string) => void;
}

// Full List of Real Categories in the App
const POPULAR_CATEGORIES = [
  { id: 'Technology', name: 'Technology', arName: 'تقنية', gradient: 'from-indigo-500 to-purple-600', icon: PieChart },
  { id: 'Social', name: 'Social', arName: 'اجتماعي', gradient: 'from-blue-500 to-cyan-500', icon: Users },
  { id: 'Economic', name: 'Economic', arName: 'اقتصادي', gradient: 'from-emerald-500 to-teal-650', icon: FileText },
  { id: 'Political', name: 'Political', arName: 'سياسي', gradient: 'from-red-500 to-rose-650', icon: Shield },
  { id: 'Health', name: 'Health', arName: 'صحة', gradient: 'from-green-400 to-emerald-550', icon: Flame },
  { id: 'Educational', name: 'Education', arName: 'تعليم', gradient: 'from-amber-500 to-orange-600', icon: HelpCircle },
  { id: 'Sports', name: 'Sports', arName: 'رياضة', gradient: 'from-orange-500 to-red-550', icon: Trophy },
  { id: 'Business / Commercial', name: 'Business', arName: 'أعمال', gradient: 'from-fuchsia-500 to-pink-650', icon: PieChart },
  { id: 'Cultural', name: 'Cultural', arName: 'ثقافي', gradient: 'from-violet-500 to-purple-700', icon: Globe },
  { id: 'Entertainment', name: 'Entertainment', arName: 'ترفيه', gradient: 'from-pink-400 to-rose-550', icon: Sparkles }
];

const TRENDING_TOPICS_CACHE_KEY = 'si_trending_topics_v1';
const readCachedTrendingTopics = (): any[] => {
  try {
    const cached = JSON.parse(sessionStorage.getItem(TRENDING_TOPICS_CACHE_KEY) || 'null');
    return Array.isArray(cached?.items) && Date.now() - Number(cached.cachedAt) < 5 * 60_000
      ? cached.items
      : [];
  } catch {
    return [];
  }
};

// Helper for highlighting text
const HighlightedText: React.FC<{ text: string; highlight: string; className?: string }> = ({ text, highlight, className = "" }) => {
  if (!highlight.trim()) return <span className={className}>{text}</span>;

  const parts = text.split(new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ?
          <span key={i} className="bg-blue-100 text-blue-800 rounded-[2px] px-0.5 font-medium">{part}</span> :
          part
      )}
    </span>
  );
};

export const SearchScreen: React.FC<SearchScreenProps> = ({ surveys, onSurveyClick, onAuthorClick, onGroupClick }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRtl = ['ar', 'ur'].includes(i18n.language?.split('-')[0]);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'All' | 'Topics' | 'Surveys' | 'Polls' | 'Groups' | 'Categories' | 'People'>('All');
  const [isLoading, setIsLoading] = useState(false);
  const [trendingTopics, setTrendingTopics] = useState<any[]>(readCachedTrendingTopics);

  // Unified Search Results from API
  const [searchResults, setSearchResults] = useState<{
    topics: any[];
    surveys: any[];
    people: any[];
    groups: any[];
    categories: string[];
  }>({ topics: [], surveys: [], people: [], groups: [], categories: [] });

  useEffect(() => {
    const controller = new AbortController();
    api.getTrendingHashtags(8, controller.signal)
      .then((result) => {
        const items = result.topics || [];
        setTrendingTopics(items);
        try {
          sessionStorage.setItem(TRENDING_TOPICS_CACHE_KEY, JSON.stringify({ items, cachedAt: Date.now() }));
        } catch { }
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.error('Failed to fetch trending topics:', error);
      });
    return () => controller.abort();
  }, []);

  // Persisted Recent Searches (In localStorage)
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('si_recent_searches');
      return saved ? JSON.parse(saved) : ['Remote Work', 'Climate Change', 'Coffee'];
    } catch {
      return ['Remote Work', 'Climate Change', 'Coffee'];
    }
  });

  // Debounce logic
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Persist search history helpers
  const handleAddRecentSearch = (term: string) => {
    const cleanTerm = term.trim();
    if (!cleanTerm || cleanTerm.length < 2) return;
    setRecentSearches(prev => {
      const filtered = prev.filter(t => t.toLowerCase() !== cleanTerm.toLowerCase());
      const next = [cleanTerm, ...filtered].slice(0, 10);
      localStorage.setItem('si_recent_searches', JSON.stringify(next));
      return next;
    });
  };

  const handleDeleteRecentSearch = (e: React.MouseEvent, term: string) => {
    e.stopPropagation();
    setRecentSearches(prev => {
      const next = prev.filter(t => t !== term);
      localStorage.setItem('si_recent_searches', JSON.stringify(next));
      return next;
    });
  };

  const handleClearRecent = () => {
    setRecentSearches([]);
    localStorage.removeItem('si_recent_searches');
  };

  // Fetch Results from API on Debounced Query Change
  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery.trim().length < 2) {
      setSearchResults({ topics: [], surveys: [], people: [], groups: [], categories: [] });
      return;
    }

    setIsLoading(true);
    const controller = new AbortController();

    const performSearch = async () => {
      try {
        const data = await api.searchAll(debouncedQuery, controller.signal);
        setSearchResults(data);
        handleAddRecentSearch(debouncedQuery);
      } catch (err: any) {
        if (err?.name !== 'AbortError') console.error('Failed to fetch search results:', err);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    performSearch();

    return () => {
      controller.abort();
    };
  }, [debouncedQuery]);

  // Filter Logic
  const showSurveys = (activeFilter === 'All' || activeFilter === 'Surveys' || activeFilter === 'Polls');
  const showTopics = (activeFilter === 'All' || activeFilter === 'Topics');
  const showPeople = (activeFilter === 'All' || activeFilter === 'People');
  const showGroups = (activeFilter === 'All' || activeFilter === 'Groups');
  const showCategories = (activeFilter === 'All' || activeFilter === 'Categories');

  // Filter Post by Type (Survey vs Poll)
  const filteredSurveys = searchResults.surveys.filter(s => {
    if (activeFilter === 'Surveys') return s.type === 'Survey';
    if (activeFilter === 'Polls') return s.type === 'Poll' || s.type === 'Trending';
    return true;
  });

  const hasResults = searchResults.topics.length > 0 || filteredSurveys.length > 0 || searchResults.people.length > 0 || searchResults.groups.length > 0 || searchResults.categories.length > 0;

  const getFilterLabel = (filter: string) => {
    if (filter === 'All') return isRtl ? 'الكل' : 'All';
    if (filter === 'Topics') return isRtl ? 'المواضيع' : 'Topics';
    if (filter === 'Surveys') return t('Surveys');
    if (filter === 'Polls') return t('Polls');
    if (filter === 'Groups') return t('Groups');
    if (filter === 'Categories') return t('Categories');
    if (filter === 'People') return isRtl ? 'الحسابات' : 'Creators';
    return filter;
  };

  const openTopic = (normalizedName: string) => {
    Analytics.track({
      event_type: 'HASHTAG_SEARCH_SELECTED',
      source_surface: 'SEARCH'
    });
    navigate(`/hashtag/${encodeURIComponent(normalizedName)}`);
  };

  return (
    <div className="bg-white min-h-[100dvh] flex flex-col pb-20" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* 1. Header & Input */}
      <div className="sticky top-0 bg-white z-20 px-4 py-3 border-b border-gray-100 shadow-sm">
        <div className="relative">
          <Search className={`absolute ${isRtl ? 'right-3.5' : 'left-3.5'} top-1/2 -translate-y-1/2 text-gray-400`} size={18} />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isRtl ? "البحث عن استطلاعات، استبيانات، مجموعات..." : "Search surveys, polls, groups, or creators..."}
            className={`w-full bg-gray-100 border-none rounded-2xl ${isRtl ? 'pr-10 pl-10' : 'pl-10 pr-10'} py-3.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 placeholder-gray-500 transition-all`}
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setDebouncedQuery(''); }}
              className={`absolute ${isRtl ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 p-1 rounded-full bg-gray-200 text-gray-500 hover:bg-gray-300`}
            >
              <X size={14} strokeWidth={3} />
            </button>
          )}
        </div>

        {/* Filter Chips (Only show when searching) */}
        {query && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar mt-3 pb-1">
            {['All', 'Topics', 'Surveys', 'Polls', 'Groups', 'Categories', 'People'].map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter as any)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors border ${activeFilter === filter
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
              >
                {getFilterLabel(filter)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2. Content Body */}
      <div className="flex-1 overflow-y-auto no-scrollbar">

        {/* State A: Empty (Discovery) */}
        {!query && (
          <div className="p-5 space-y-8 animate-in fade-in duration-300">

            {/* Recent Searches */}
            {recentSearches.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{isRtl ? 'عمليات البحث الأخيرة' : 'Recent Searches'}</h3>
                  <button onClick={handleClearRecent} className="text-xs font-semibold text-blue-600 hover:text-blue-700">{t('Reset All')}</button>
                </div>
                <div className="space-y-1">
                  {recentSearches.map((term, idx) => (
                    <button
                      key={idx}
                      onClick={() => setQuery(term)}
                      className="flex items-center justify-between w-full p-2.5 rounded-xl hover:bg-gray-50 text-left group transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Clock size={16} className="text-gray-400 group-hover:text-gray-600" />
                        <span className="text-sm text-gray-700 font-medium group-hover:text-gray-900">{term}</span>
                      </div>
                      <span 
                        onClick={(e) => handleDeleteRecentSearch(e, term)}
                        className="p-1 rounded-full text-gray-305 hover:text-gray-600 hover:bg-gray-200/50 shrink-0"
                      >
                        <X size={14} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Trending Topics */}
            {trendingTopics.length > 0 && <section>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                <TrendingUp size={12} /> {isRtl ? 'رائج الآن' : 'Trending Now'}
              </h3>
              <div className="flex flex-wrap gap-2">
                {trendingTopics.map((topic) => (
                  <button
                    key={topic.id}
                    onClick={() => openTopic(topic.normalizedName)}
                    className="px-3.5 py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors"
                  >
                    #{topic.displayName}
                  </button>
                ))}
              </div>
            </section>}

            {/* Popular Categories (Now Complete) */}
            <section>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">{t('Categories')}</h3>
              <div className="grid grid-cols-2 gap-3">
                {POPULAR_CATEGORIES.map((c) => {
                  const Icon = c.icon;
                  return (
                    <button 
                      key={c.id} 
                      onClick={() => setQuery(c.name)} 
                      className={`bg-gradient-to-br ${c.gradient} text-white p-4 rounded-2xl text-left shadow-sm hover:shadow-md transition-all flex flex-col justify-between h-24`}
                    >
                      <Icon className="opacity-80 shrink-0" size={20} />
                      <span className="font-extrabold text-sm block leading-none">{isRtl ? c.arName : c.name}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* State B: Live Results & Loading */}
        {query && (
          <div className="p-4 space-y-6">
            {isLoading ? (
              <div className="space-y-6">
                {/* Categories Skeleton */}
                <div className="flex gap-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="w-20 h-8 bg-gray-100 rounded-lg animate-pulse" />
                  ))}
                </div>
                {/* People Skeleton */}
                <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
                  {[1, 2].map(i => (
                    <div key={i} className="flex items-center justify-between animate-pulse">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gray-200 rounded-full" />
                        <div className="space-y-2">
                          <div className="h-3 bg-gray-200 rounded-md w-24" />
                          <div className="h-2.5 bg-gray-200 rounded-md w-16" />
                        </div>
                      </div>
                      <div className="w-12 h-6 bg-gray-200 rounded-full" />
                    </div>
                  ))}
                </div>
                {/* Posts Skeleton */}
                <div className="space-y-3">
                  {[1, 2].map(i => (
                    <div key={i} className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm animate-pulse space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gray-200 rounded-full" />
                        <div className="space-y-2 flex-1">
                          <div className="h-3.5 bg-gray-200 rounded-md w-1/3" />
                          <div className="h-2.5 bg-gray-200 rounded-md w-1/4" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="h-4 bg-gray-200 rounded-md w-3/4" />
                        <div className="h-3 bg-gray-200 rounded-md w-full" />
                      </div>
                      <div className="flex gap-4 pt-2">
                        <div className="h-6 bg-gray-200 rounded-full w-16" />
                        <div className="h-6 bg-gray-200 rounded-full w-16" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : !hasResults ? (
              <div className="flex flex-col items-center justify-center pt-12 text-center animate-in fade-in duration-200">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                  <Search size={24} className="text-gray-300" />
                </div>
                <h3 className="text-gray-900 font-bold mb-1">{isRtl ? 'لا توجد نتائج' : 'No results found'}</h3>
                <p className="text-sm text-gray-500">{isRtl ? `لم نجد أي تطابقات لـ "${query}"` : `We couldn't find anything matching "${query}"`}</p>
              </div>
            ) : (
              <>
                {/* 1. Hashtag Topics */}
                {showTopics && searchResults.topics.length > 0 && (
                  <section className="animate-in fade-in slide-in-from-bottom-2">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">
                      {isRtl ? 'المواضيع' : 'Topics'}
                    </h3>
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-50">
                      {searchResults.topics.map((topic) => (
                        <button
                          key={topic.id}
                          onClick={() => openTopic(topic.normalizedName)}
                          className="w-full flex items-center justify-between gap-3 p-3.5 text-start hover:bg-gray-50 transition-colors"
                        >
                          <span className="flex items-center gap-3 min-w-0">
                            <span className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><Hash size={17} /></span>
                            <span className="font-bold text-sm text-gray-900 truncate">#{topic.displayName}</span>
                          </span>
                          <span className="text-xs text-gray-500 shrink-0">{topic.postCount} {isRtl ? 'منشور' : 'posts'}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* 2. Categories */}
                {showCategories && searchResults.categories.length > 0 && (
                  <section className="animate-in fade-in slide-in-from-bottom-2">
                    {activeFilter === 'All' && <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">{t('Categories')}</h3>}
                    <div className="flex flex-wrap gap-2">
                      {searchResults.categories.map(cat => (
                        <button
                          key={cat}
                          onClick={() => setQuery(cat)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-bold hover:border-blue-350 hover:text-blue-600 transition-colors"
                        >
                          <Hash size={12} className="text-gray-400" />
                          <HighlightedText text={cat} highlight={debouncedQuery} />
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* 2. People (Creators) */}
                {showPeople && searchResults.people.length > 0 && (
                  <section className="animate-in fade-in slide-in-from-bottom-2">
                    {activeFilter === 'All' && (
                      <div className="flex justify-between items-center mb-2 px-1">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{isRtl ? 'الحسابات' : 'Creators'}</h3>
                        {searchResults.people.length > 3 && <button onClick={() => setActiveFilter('People')} className="text-xs text-blue-600 font-bold">{isRtl ? 'عرض الكل' : 'See all'}</button>}
                      </div>
                    )}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      {(activeFilter === 'All' ? searchResults.people.slice(0, 3) : searchResults.people).map((person, i) => (
                        <div key={i} className="flex items-center justify-between p-3.5 hover:bg-gray-50 border-b border-gray-55 last:border-0 transition-colors">
                          <div className="flex items-center gap-3">
                            <UserAvatar 
                              src={person.avatar} 
                              mediaId={person.avatarMediaId}
                              media={person.avatarMedia}
                              name={person.name}
                              alt={person.name} 
                              size={40} 
                              className="border border-gray-100" 
                            />
                            <div>
                              <div className="text-sm font-bold text-gray-900"><HighlightedText text={person.name} highlight={debouncedQuery} /></div>
                              <div className="text-xs text-gray-500">@{person.handle || '—'}</div>
                            </div>
                          </div>
                          <button
                            onClick={() => onAuthorClick?.({ id: person.id, name: person.name, avatar: person.avatar, handle: person.handle })}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-full text-xs font-bold hover:bg-gray-200 transition-colors">{t('View')}</button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* 3. Groups */}
                {showGroups && searchResults.groups.length > 0 && (
                  <section className="animate-in fade-in slide-in-from-bottom-2">
                    {activeFilter === 'All' && (
                      <div className="flex justify-between items-center mb-2 px-1">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('Groups')}</h3>
                        {searchResults.groups.length > 3 && <button onClick={() => setActiveFilter('Groups')} className="text-xs text-blue-600 font-bold">{isRtl ? 'عرض الكل' : 'See all'}</button>}
                      </div>
                    )}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-50">
                      {(activeFilter === 'All' ? searchResults.groups.slice(0, 3) : searchResults.groups).map((group, i) => (
                        <div key={i} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                          <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
                            <div className="w-10 h-10 rounded-xl overflow-hidden border border-gray-100 shrink-0">
                              <MediaImage
                                media={group.imageMedia}
                                mediaId={group.imageMediaId}
                                fallbackSrc={group.image?.includes('ui-avatars') ? undefined : group.image}
                                fallback={<span role="img" aria-label={group.name} className="flex h-full w-full items-center justify-center bg-gray-100 text-sm font-bold text-gray-500">{group.name.trim().charAt(0).toUpperCase()}</span>}
                                alt={group.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-bold text-gray-900 truncate">
                                <HighlightedText text={group.name} highlight={debouncedQuery} />
                              </div>
                              <p className="text-xs text-gray-500 truncate mt-0.5">{group.description || 'No description'}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => onGroupClick?.(group.id)}
                            className="px-3.5 py-1.5 bg-blue-50 text-blue-600 rounded-full text-xs font-bold hover:bg-blue-100 shrink-0"
                          >
                            {t('View')}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* 4. Surveys & Polls */}
                {showSurveys && filteredSurveys.length > 0 && (
                  <section className="animate-in fade-in slide-in-from-bottom-2">
                    {activeFilter === 'All' && <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">{t('Surveys')} & {t('Polls')}</h3>}

                    <div className="space-y-3">
                      {filteredSurveys.map(survey => (
                        <div
                          key={survey.clientKey || survey.id}
                          onClick={() => onSurveyClick(survey.id, 'SEARCH')}
                          className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-3 active:scale-[0.99] transition-transform cursor-pointer"
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wide ${survey.type === 'Poll' || survey.type === 'Trending' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                                  }`}>
                                  {survey.type}
                                </span>
                                {survey.category && <span className="text-[10px] text-gray-400 font-medium">• {survey.category}</span>}
                              </div>
                              <h4 className="font-bold text-gray-900 leading-tight mb-1">
                                <HighlightedText text={survey.title} highlight={debouncedQuery} />
                              </h4>
                              <p className="text-xs text-gray-500 line-clamp-2">
                                <HighlightedText text={survey.description} highlight={debouncedQuery} />
                              </p>
                            </div>
                            {(survey.media?.length || survey.coverImage) && (
                              <MediaImage media={survey.media?.[0]} fallbackSrc={survey.coverImage} sizes="64px" className="w-16 h-16 rounded-lg object-cover ml-3 bg-gray-100 shrink-0" alt="" />
                            )}
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-gray-50 mt-1">
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <UserAvatar src={survey.author?.avatar} mediaId={survey.author?.avatarMediaId} media={survey.author?.avatarMedia} name={survey.author?.name} alt={survey.author?.name || 'Author'} size={16} />
                              <span>{survey.author?.name}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-gray-400 font-medium">
                              <span>{survey.participants || 0} {t('votes')}</span>
                              <span>{survey.timeLeft || 'Active'}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
