import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Filter, TrendingUp, Users, MessageCircle, Share2,
  ChevronRight, ChevronLeft, Globe, Search, X, Check, RotateCcw,
  Trophy, Flame, BarChart3, PieChart, HelpCircle, FileText, Sparkles, RefreshCw
} from 'lucide-react';
import { Survey, SurveyType } from '../types';
import { BottomSheet } from './BottomSheet';
import { api } from '../services/api';
import { UserAvatar } from './UserAvatar';

interface TrendsScreenProps {
  surveys?: Survey[]; // Kept for prop-type compatibility (fallback)
  onSurveyClick: (id: string, surface?: string) => void;
}

const COUNTRIES = [
  { code: 'ALL', name: 'Global', arName: 'عالمي' },
  { code: 'SA', name: 'Saudi Arabia', arName: 'السعودية' },
  { code: 'QA', name: 'Qatar', arName: 'قطر' },
  { code: 'JO', name: 'Jordan', arName: 'الأردن' },
  { code: 'AE', name: 'United Arab Emirates', arName: 'الإمارات' },
  { code: 'EG', name: 'Egypt', arName: 'مصر' },
  { code: 'US', name: 'United States', arName: 'أمريكا' },
  { code: 'UK', name: 'United Kingdom', arName: 'بريطانيا' },
];

const CATEGORIES = [
  "Technology", "Social", "Business", "Sports", "Politics",
  "Entertainment", "Health", "Education", "Lifestyle", "Science"
];

const TRENDS_CACHE_TTL_MS = 2 * 60_000;
const readTrendsCache = (key: string): any[] | null => {
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
    return Array.isArray(cached?.items) && Date.now() - Number(cached.cachedAt) < TRENDS_CACHE_TTL_MS
      ? cached.items
      : null;
  } catch {
    return null;
  }
};

export const TrendsScreen: React.FC<TrendsScreenProps> = ({ onSurveyClick }) => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';

  // 1. Core Filter State (Persisted in sessionStorage)
  const [period, setPeriod] = useState<string>(() => {
    return sessionStorage.getItem('si_trends_period') || '24h';
  });
  const [contentType, setContentType] = useState<string>(() => {
    return sessionStorage.getItem('si_trends_type') || 'all';
  });
  const [limit, setLimit] = useState<number>(() => {
    return parseInt(sessionStorage.getItem('si_trends_limit') || '10');
  });

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [trendingItems, setTrendingItems] = useState<any[]>([]);
  const trendsAbortRef = React.useRef<AbortController | null>(null);

  // 2. Temp Filter State (for Bottom Sheet)
  const [tempCountry, setTempCountry] = useState(() => {
    return sessionStorage.getItem('si_trends_country') || 'ALL';
  });
  const [tempCategories, setTempCategories] = useState<string[]>(() => {
    try {
      const saved = sessionStorage.getItem('si_trends_cats');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Active filter state after applying
  const [activeCountry, setActiveCountry] = useState(() => {
    return sessionStorage.getItem('si_trends_country') || 'ALL';
  });
  const [activeCategories, setActiveCategories] = useState<string[]>(() => {
    try {
      const saved = sessionStorage.getItem('si_trends_cats');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // 3. Save states to SessionStorage
  useEffect(() => {
    sessionStorage.setItem('si_trends_period', period);
    sessionStorage.setItem('si_trends_type', contentType);
    sessionStorage.setItem('si_trends_limit', limit.toString());
    sessionStorage.setItem('si_trends_country', activeCountry);
    sessionStorage.setItem('si_trends_cats', JSON.stringify(activeCategories));
  }, [period, contentType, limit, activeCountry, activeCategories]);

  // 4. Fetch Trends API helper
  const fetchTrends = async (silent = false) => {
    trendsAbortRef.current?.abort();
    const controller = new AbortController();
    trendsAbortRef.current = controller;
    const params = {
      period,
      type: contentType === 'all' ? undefined : contentType,
      country: activeCountry === 'ALL' ? undefined : activeCountry,
      limit,
      category: activeCategories.length > 0 ? activeCategories.join(',') : undefined
    };
    const cacheKey = `si_trends_v1:${JSON.stringify(params)}`;
    const cached = readTrendsCache(cacheKey);
    if (cached) {
      setTrendingItems(cached);
      setHasError(false);
      if (!silent) setIsLoading(false);
    }
    if (!silent) {
      if (!cached) setIsLoading(true);
      setHasError(false);
    }
    try {
      const data = await api.getTrends(params, controller.signal);
      setTrendingItems(data || []);
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ items: data || [], cachedAt: Date.now() }));
      } catch { }
      setHasError(false);
    } catch (err: any) {
      if (err?.name !== 'AbortError' && !cached) {
        console.error('Failed to load trends:', err);
        setHasError(true);
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  // Fetch when active filters change
  useEffect(() => {
    void fetchTrends();
    return () => trendsAbortRef.current?.abort();
  }, [period, contentType, limit, activeCountry, activeCategories]);

  const handleApplyFilters = () => {
    setActiveCountry(tempCountry);
    setActiveCategories(tempCategories);
    setIsFilterOpen(false);
  };

  const handleResetFilters = () => {
    setTempCountry('ALL');
    setTempCategories([]);
    setActiveCountry('ALL');
    setActiveCategories([]);
    setPeriod('24h');
    setContentType('all');
    setLimit(10);
    setIsFilterOpen(false);
  };

  const toggleCategory = (cat: string) => {
    setTempCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const getTypeLabel = (typeStr: string) => {
    const norm = typeStr.toUpperCase();
    if (norm === 'POLL') return t('Polls');
    if (norm === 'SURVEY') return t('Surveys');
    if (norm === 'QUIZ') return t('Quizzes');
    if (norm === 'CHALLENGE') return t('Challenges');
    return typeStr;
  };

  const getCountryName = (code: string) => {
    const found = COUNTRIES.find(c => c.code === code);
    if (!found) return t('Global');
    return isRtl ? found.arName : found.name;
  };

  const getTrendingReasonTranslation = (reason: string) => {
    if (reason === 'الأكثر تعليقاً') return t('Most Commented');
    if (reason === 'ينمو بسرعة') return t('Growing Rapidly');
    if (reason === 'صاعد حديثاً') return t('Rising');
    if (reason === 'تفاعل نشط') return t('High Engagement');
    return reason;
  };

  const hasActiveFilters = activeCountry !== 'ALL' || activeCategories.length > 0;

  return (
    <div className="flex flex-col h-full bg-white select-none" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* 1. Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100 bg-white sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <TrendingUp className="text-red-500 shrink-0" size={24} strokeWidth={2.5} />
          <h1 className="text-xl font-black text-gray-900 tracking-tight">{t('Trends')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchTrends(false)}
            className="p-2.5 rounded-xl border border-gray-100 bg-white text-gray-400 hover:text-gray-600 transition-all active:scale-90"
            title="Refresh"
          >
            <RefreshCw size={18} />
          </button>
          <button
            onClick={() => {
              setTempCountry(activeCountry);
              setTempCategories(activeCategories);
              setIsFilterOpen(true);
            }}
            className={`relative p-2.5 rounded-xl border transition-all active:scale-95 ${hasActiveFilters
              ? 'bg-blue-50 border-blue-200 text-blue-600 font-bold'
              : 'bg-white border-gray-100 text-gray-400'
              }`}
          >
            <Filter size={18} />
            {hasActiveFilters && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white shadow-sm" />
            )}
          </button>
        </div>
      </div>

      {/* 2. Time Frames & Content Type Selector */}
      <div className="px-4 py-3 bg-white border-b border-gray-100 shadow-sm flex flex-col gap-2.5 shrink-0">
        {/* Row 1: Time Frame Tabs */}
        <div className="flex gap-1.5 p-1 bg-gray-100 rounded-xl">
          {[
            { code: '24h', label: t('Today (24h)') },
            { code: '7d', label: t('Week (7d)') },
            { code: '30d', label: t('Month (30d)') },
            { code: 'all', label: t('All Time') }
          ].map(tab => (
            <button
              key={tab.code}
              onClick={() => setPeriod(tab.code)}
              className={`flex-1 py-2 text-center text-xs font-extrabold rounded-lg transition-all ${period === tab.code
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-400 hover:text-gray-600'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Row 2: Content Types & Limit Selectors */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
          {['all', 'Poll', 'Survey', 'Quiz', 'Challenge'].map(type => (
            <button
              key={type}
              onClick={() => setContentType(type)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors border ${contentType === type
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-500 border-gray-100 hover:border-gray-250'
                }`}
            >
              {type === 'all' ? t('All Types') : getTypeLabel(type)}
            </button>
          ))}

          {/* Divider */}
          <span className="h-6 w-[1px] bg-gray-200 shrink-0 self-center mx-1" />

          {/* Top selection */}
          {[10, 20, 50].map(n => (
            <button
              key={n}
              onClick={() => setLimit(n)}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors ${limit === n
                ? 'bg-blue-50 text-blue-600 border border-blue-200'
                : 'bg-gray-50 text-gray-400 border border-transparent hover:bg-gray-100'
                }`}
            >
              TOP {n}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Summary Detail Header */}
      {!isLoading && !hasError && trendingItems.length > 0 && (
        <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-400 flex items-center gap-1.5 shrink-0">
          <Sparkles size={12} className="text-yellow-500" />
          <span>
            {t('Top 10 in')} {getCountryName(activeCountry)} · {period === '24h' ? t('Today (24h)') : period === '7d' ? t('Week (7d)') : period === '30d' ? t('Month (30d)') : t('All Time')}
            {activeCategories.length > 0 ? ` · ${activeCategories.slice(0, 2).join(', ')}` : ''}
          </span>
        </div>
      )}

      {/* 4. Content List */}
      <div className="flex-1 overflow-y-auto no-scrollbar bg-gray-50/50">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map(i => (
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
        ) : hasError ? (
          <div className="flex flex-col items-center justify-center py-20 px-10 text-center animate-in fade-in duration-300">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-4">
              <RotateCcw size={32} />
            </div>
            <h3 className="text-gray-900 font-bold text-lg mb-2">Failed to load trends</h3>
            <p className="text-gray-500 text-sm">There was a problem communicating with the server. Please try again.</p>
            <button
              onClick={() => fetchTrends(false)}
              className="mt-6 px-6 py-2.5 bg-gray-900 text-white rounded-xl text-xs font-bold active:scale-95 transition-all shadow-md"
            >
              Retry
            </button>
          </div>
        ) : trendingItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-10 text-center animate-in fade-in duration-300">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-300">
              <Search size={32} />
            </div>
            <h3 className="text-gray-900 font-bold text-lg mb-1">{t('No trends match your filters')}</h3>
            <p className="text-gray-400 text-sm max-w-sm">{t('Try adjusting your category or country selection to see what\'s happening elsewhere.')}</p>
            <button
              onClick={handleResetFilters}
              className="mt-6 text-blue-600 font-extrabold text-xs flex items-center gap-1.5 hover:text-blue-700"
            >
              <RotateCcw size={14} /> {t('Reset All')}
            </button>
          </div>
        ) : (
          <div className="p-4 space-y-3.5 pb-24">
            {trendingItems.map((item, index) => {
              const isTop3 = index < 3;
              const isTop1 = index === 0;
              const isTop2 = index === 1;
              const isTop3Index = index === 2;

              // Gold, Silver, Bronze theme styles
              const cardBg = isTop1
                ? 'bg-gradient-to-br from-yellow-50/20 via-white to-amber-50/10 border-yellow-250/70 shadow-yellow-500/5'
                : isTop2
                ? 'bg-gradient-to-br from-slate-50/20 via-white to-gray-50/10 border-slate-200/70 shadow-slate-500/5'
                : isTop3Index
                ? 'bg-gradient-to-br from-orange-50/20 via-white to-amber-50/10 border-orange-200/70 shadow-orange-500/5'
                : 'bg-white border-gray-100 shadow-sm';

              const badgeColor = isTop1
                ? 'bg-yellow-100 text-yellow-700 ring-yellow-300'
                : isTop2
                ? 'bg-slate-100 text-slate-600 ring-slate-300'
                : isTop3Index
                ? 'bg-orange-100 text-orange-700 ring-orange-300'
                : 'bg-gray-100 text-gray-400 ring-gray-200';

              return (
                <div
                  key={item.id}
                  onClick={() => onSurveyClick(item.id, 'TRENDING')}
                  className={`group relative flex flex-col gap-3 p-4 rounded-3xl border active:scale-[0.98] transition-all cursor-pointer ${cardBg}`}
                >
                  {/* Top Header Row: Author, Tags, and Rank */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Avatar */}
                      <UserAvatar 
                        src={item.author.avatar} 
                        mediaId={item.author.avatarMediaId}
                        media={item.author.avatarMedia}
                        name={item.author.name}
                        alt={item.author.name} 
                        size={36} 
                        className="shrink-0 border border-gray-100" 
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold text-gray-900 truncate">{item.author.name}</div>
                        <div className="text-[10px] text-gray-400 truncate">@{item.author.handle || '—'}</div>
                      </div>
                    </div>

                    {/* Rank Badge */}
                    <div className="shrink-0 relative">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs ring-1 ring-inset ${badgeColor}`}>
                        {index + 1}
                      </div>
                      {isTop3 && (
                        <Trophy size={12} className="absolute -top-1 -right-1 text-yellow-500 fill-yellow-500 drop-shadow-sm" />
                      )}
                    </div>
                  </div>

                  {/* Body Title & Description */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                        item.type.toLowerCase() === 'poll' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-blue-50 text-blue-700 border border-blue-100'
                      }`}>
                        {getTypeLabel(item.type)}
                      </span>
                      {item.category && (
                        <span className="text-[9px] font-extrabold px-1.5 py-0.5 bg-gray-50 border border-gray-100 rounded text-gray-400">
                          {item.category}
                        </span>
                      )}
                      {item.author.location && (
                        <span className="text-[9px] font-semibold text-gray-400 flex items-center gap-0.5">
                          <Globe size={10} /> {item.author.location}
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-bold text-gray-900 group-hover:text-blue-600 transition-colors leading-snug pt-1">
                      {item.title}
                    </h3>
                    <p className="text-xs text-gray-500 line-clamp-2">{item.description}</p>
                  </div>

                  {/* Divider */}
                  <div className="h-[1px] bg-gray-50" />

                  {/* Footer Row: Engagement and Trend Reason */}
                  <div className="flex items-center justify-between text-gray-400 text-xs">
                    <div className="flex items-center gap-4 font-semibold">
                      <div className="flex items-center gap-1.5 hover:text-gray-600">
                        <Users size={14} strokeWidth={2.5} />
                        <span>{item.participants || 0}</span>
                      </div>
                      <div className="flex items-center gap-1.5 hover:text-gray-600">
                        <MessageCircle size={14} strokeWidth={2.5} />
                        <span>{item.commentsCount || 0}</span>
                      </div>
                    </div>

                    {/* Trend Reason Tag */}
                    <div className="flex items-center gap-1 text-red-500 font-extrabold text-[10px] bg-red-50/50 px-2.5 py-1 rounded-full border border-red-100/50">
                      <Flame size={12} fill="currentColor" />
                      <span>{getTrendingReasonTranslation(item.trendingReason)}</span>
                    </div>
                  </div>

                  {/* absolute arrow locator */}
                  <div className={`absolute ${isRtl ? 'left-4' : 'right-4'} top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all pointer-events-none`}>
                    {isRtl ? (
                      <ChevronLeft size={20} className="text-blue-500 translate-x-1" />
                    ) : (
                      <ChevronRight size={20} className="text-blue-500 -translate-x-1" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* FILTER BOTTOM SHEET */}
      <BottomSheet
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        title={t('Filter Trends')}
        customLayout={true}
      >
        <div className="flex flex-col h-full bg-white" dir={isRtl ? 'rtl' : 'ltr'}>
          <div className="flex-1 overflow-y-auto px-5 py-4 no-scrollbar">
            {/* Country Selection */}
            <div className="mb-6">
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-1">
                {t('Country')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {COUNTRIES.map((c) => (
                  <button
                    key={c.code}
                    onClick={() => setTempCountry(c.code)}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl border text-xs font-bold transition-all ${tempCountry === c.code
                      ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500/20'
                      : 'bg-white border-gray-100 text-gray-600 hover:border-gray-250'
                      }`}
                  >
                    <span>{isRtl ? c.arName : c.name}</span>
                    {tempCountry === c.code && <Check size={14} strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Selection */}
            <div>
              <div className="flex items-center justify-between mb-3 px-1">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  {t('Categories')}
                </label>
                <span className="text-[10px] font-bold text-blue-600 uppercase">Multi-select</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${tempCategories.includes(cat)
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-gray-500 border-gray-100 hover:border-gray-300'
                      }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Fixed Footer Actions */}
          <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50 flex gap-3 pb-safe">
            <button
              onClick={handleResetFilters}
              className="flex-1 py-3.5 bg-white border border-gray-200 text-gray-500 rounded-xl font-bold uppercase tracking-wider text-xs active:scale-95 transition-all shadow-sm"
            >
              {t('Reset All')}
            </button>
            <button
              onClick={handleApplyFilters}
              className="flex-[2] py-3.5 bg-blue-600 text-white rounded-xl font-bold uppercase tracking-wider text-xs active:scale-95 transition-all shadow-md shadow-blue-500/20"
            >
              {t('Apply Filters')}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};
