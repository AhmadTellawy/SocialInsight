import React, { useState, useMemo, useEffect } from 'react';
import {
  Filter, TrendingUp, Users, MessageCircle, Share2,
  ChevronRight, Globe, Search, X, Check, RotateCcw,
  Trophy, Flame, BarChart3, PieChart, HelpCircle, FileText
} from 'lucide-react';
import { Survey, SurveyType } from '../types';
import { BottomSheet } from './BottomSheet';

interface TrendsScreenProps {
  surveys: Survey[];
  onSurveyClick: (id: string, surface?: string) => void;
}

const COUNTRIES = [
  { code: 'ALL', name: 'Global / All' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'QA', name: 'Qatar' },
  { code: 'JO', name: 'Jordan' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'EG', name: 'Egypt' },
  { code: 'US', name: 'United States' },
  { code: 'UK', name: 'United Kingdom' },
];

const CATEGORIES = [
  "Technology", "Social", "Business", "Sports", "Politics",
  "Entertainment", "Health", "Education", "Lifestyle", "Science"
];

export const TrendsScreen: React.FC<TrendsScreenProps> = ({ surveys, onSurveyClick }) => {
  // 1. Core State
  const [contentType, setContentType] = useState<SurveyType>(SurveyType.POLL);
  const [topN, setTopN] = useState<number>(10);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 2. Filter State
  const [tempCountry, setTempCountry] = useState('ALL');
  const [tempCategories, setTempCategories] = useState<string[]>([]);

  const [activeCountry, setActiveCountry] = useState('ALL');
  const [activeCategories, setActiveCategories] = useState<string[]>([]);

  // 3. Derived Filter Logic
  const hasActiveFilters = activeCountry !== 'ALL' || activeCategories.length > 0;

  // 4. Filtered Data
  const trendingItems = useMemo(() => {
    // In a real app, this would be an API call.
    // Here we simulate filtering and ranking using our mock data.
    let filtered = surveys.filter(s => {
      // Content Type Filter
      if (contentType === SurveyType.POLL) return s.type === SurveyType.POLL || s.type === SurveyType.TRENDING;
      return s.type === contentType;
    });

    // Category Filter
    if (activeCategories.length > 0) {
      filtered = filtered.filter(s => s.category && activeCategories.includes(s.category));
    }

    // Country Filter (Simulated - adding random countries to mock data for display)
    // In real app, the backend handles this.

    // Sort by "Trending Score" (simulated by engagement metrics)
    return filtered
      .sort((a, b) => (b.participants + b.likes) - (a.participants + a.likes))
      .slice(0, topN);
  }, [surveys, contentType, topN, activeCountry, activeCategories]);

  const handleApplyFilters = () => {
    setIsLoading(true);
    setActiveCountry(tempCountry);
    setActiveCategories(tempCategories);
    setIsFilterOpen(false);

    // Simulate API delay
    setTimeout(() => setIsLoading(false), 500);
  };

  const handleResetFilters = () => {
    setIsLoading(true);
    setTempCountry('ALL');
    setTempCategories([]);
    setActiveCountry('ALL');
    setActiveCategories([]);
    setContentType(SurveyType.POLL);
    setTopN(10);
    setIsFilterOpen(false);
    setTimeout(() => setIsLoading(false), 500);
  };

  const toggleCategory = (cat: string) => {
    setTempCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const getTypeIcon = (type: SurveyType) => {
    switch (type) {
      case SurveyType.POLL: return <PieChart size={14} />;
      case SurveyType.QUIZ: return <HelpCircle size={14} />;
      case SurveyType.SURVEY: return <FileText size={14} />;
      default: return <BarChart3 size={14} />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* HEADER */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-gray-50 bg-white sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <TrendingUp className="text-red-500" size={24} strokeWidth={2.5} />
          <h1 className="text-xl font-black text-gray-900 tracking-tight">Trends</h1>
        </div>
        <button
          onClick={() => {
            setTempCountry(activeCountry);
            setTempCategories(activeCategories);
            setIsFilterOpen(true);
          }}
          className={`relative p-2.5 rounded-xl border transition-all active:scale-95 ${hasActiveFilters
            ? 'bg-blue-50 border-blue-200 text-blue-600'
            : 'bg-white border-gray-100 text-gray-400'
            }`}
        >
          <Filter size={20} />
          {hasActiveFilters && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white shadow-sm" />
          )}
        </button>
      </div>

      {/* CONTROL BAR */}
      <div className="px-4 py-3 space-y-3 bg-white border-b border-gray-50 shadow-sm">
        {/* Row 1: Content Type */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {[SurveyType.POLL, SurveyType.QUIZ, SurveyType.SURVEY].map((type) => (
            <button
              key={type}
              onClick={() => setContentType(type)}
              className={`px-5 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap border flex items-center gap-2 ${contentType === type
                ? 'bg-gray-900 text-white border-gray-900 shadow-md'
                : 'bg-white text-gray-400 border-gray-100 hover:border-gray-200'
                }`}
            >
              {getTypeIcon(type)}
              {type}
            </button>
          ))}
        </div>

        {/* Row 2: Top-N Selection */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {[5, 10, 50, 100].map((n) => (
            <button
              key={n}
              onClick={() => setTopN(n)}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tighter transition-all border ${topN === n
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-gray-50 text-gray-400 border-transparent hover:bg-gray-100'
                }`}
            >
              TOP {n}
            </button>
          ))}
        </div>
      </div>

      {/* TRENDS LIST */}
      <div className="flex-1 overflow-y-auto no-scrollbar bg-gray-50/50">
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-28 bg-white rounded-2xl animate-pulse border border-gray-100" />
            ))}
          </div>
        ) : trendingItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-10 text-center animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-300">
              <Search size={32} />
            </div>
            <h3 className="text-gray-900 font-bold text-lg mb-2">No trends match your filters</h3>
            <p className="text-gray-500 text-sm">Try adjusting your category or country selection to see what's happening elsewhere.</p>
            <button
              onClick={handleResetFilters}
              className="mt-6 text-blue-600 font-bold text-sm flex items-center gap-2"
            >
              <RotateCcw size={16} /> Reset all filters
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {trendingItems.map((item, index) => (
              <div
                key={item.id}
                onClick={() => onSurveyClick(item.id, 'FEED')}
                className="group relative flex items-center gap-4 p-5 bg-white hover:bg-gray-50 transition-all cursor-pointer border-b border-gray-50 last:border-0"
              >
                {/* Ranking Number */}
                <div className="shrink-0 relative">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shadow-sm ${index === 0 ? 'bg-yellow-100 text-yellow-700 ring-2 ring-yellow-400' :
                    index === 1 ? 'bg-slate-100 text-slate-600 ring-2 ring-slate-300' :
                      index === 2 ? 'bg-orange-100 text-orange-700 ring-2 ring-orange-300' :
                        'bg-gray-100 text-gray-400'
                    }`}>
                    {index + 1}
                  </div>
                  {index < 3 && (
                    <Trophy size={14} className="absolute -top-1.5 -right-1.5 text-yellow-500 fill-yellow-500 drop-shadow-sm" />
                  )}
                </div>

                {/* Content Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded leading-none">
                      {item.category}
                    </span>
                    <div className="flex items-center gap-1 text-[9px] font-bold text-gray-400 uppercase">
                      <Globe size={10} /> {activeCountry === 'ALL' ? 'Global' : activeCountry}
                    </div>
                  </div>
                  <h3 className="text-sm font-bold text-gray-900 group-hover:text-blue-600 transition-colors leading-snug line-clamp-2">
                    {item.title}
                  </h3>

                  {/* Engagement Metrics */}
                  <div className="flex items-center gap-4 mt-2.5">
                    <div className="flex items-center gap-1 text-gray-400">
                      <Users size={12} strokeWidth={2.5} />
                      <span className="text-[10px] font-black uppercase tabular-nums">
                        {item.participants >= 1000 ? (item.participants / 1000).toFixed(1) + 'K' : item.participants}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-gray-400">
                      <MessageCircle size={12} strokeWidth={2.5} />
                      <span className="text-[10px] font-black uppercase tabular-nums">{item.commentsCount}</span>
                    </div>
                    <div className="ml-auto flex items-center gap-1 text-red-500">
                      <Flame size={12} fill="currentColor" />
                      <span className="text-[10px] font-black uppercase">
                        {Math.floor((item.participants + item.likes) / 10)} pts
                      </span>
                    </div>
                  </div>
                </div>

                <ChevronRight size={18} className="text-gray-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FILTER BOTTOM SHEET */}
      <BottomSheet
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        title="Filter Trends"
        customLayout={true}
      >
        <div className="flex flex-col h-full bg-white">
          <div className="flex-1 overflow-y-auto px-5 py-4 no-scrollbar">
            {/* Country Selection */}
            <div className="mb-8">
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-1">Country</label>
              <div className="grid grid-cols-2 gap-2">
                {COUNTRIES.map((c) => (
                  <button
                    key={c.code}
                    onClick={() => setTempCountry(c.code)}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl border text-xs font-bold transition-all ${tempCountry === c.code
                      ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500/20'
                      : 'bg-white border-gray-100 text-gray-600 hover:border-gray-200'
                      }`}
                  >
                    <span>{c.name}</span>
                    {tempCountry === c.code && <Check size={14} strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Selection */}
            <div>
              <div className="flex items-center justify-between mb-3 px-1">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Categories</label>
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
          <div className="px-5 py-4 border-t border-gray-50 bg-gray-50/50 flex gap-3 pb-safe">
            <button
              onClick={handleResetFilters}
              className="flex-1 py-4 bg-white border border-gray-200 text-gray-500 rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all shadow-sm"
            >
              Reset All
            </button>
            <button
              onClick={handleApplyFilters}
              className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all shadow-xl shadow-blue-500/20"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};
