import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, Clock, TrendingUp, ChevronRight, User, Users, FileText, PieChart, Hash, ArrowLeft } from 'lucide-react';
import { Survey, SurveyType } from '../types';

interface SearchScreenProps {
  surveys: Survey[];
  onSurveyClick: (id: string, surface?: string) => void;
  onAuthorClick?: (author: { id: string; name: string; avatar: string }) => void;
}

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

export const SearchScreen: React.FC<SearchScreenProps> = ({ surveys, onSurveyClick, onAuthorClick }) => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'All' | 'Surveys' | 'Polls' | 'Categories' | 'People'>('All');

  // Mock Recent Searches (In a real app, persist this to localStorage)
  const [recentSearches, setRecentSearches] = useState<string[]>(['Remote Work', 'Climate Change', 'Coffee']);

  // Debounce logic
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Derived Data: Extract People and Categories from existing surveys
  const allPeople = useMemo(() => {
    const authors = new Map<string, { id: string; name: string; avatar: string }>();
    surveys.forEach(s => authors.set(s.author.name, { id: s.author.id, name: s.author.name, avatar: s.author.avatar }));
    return Array.from(authors.values());
  }, [surveys]);

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    surveys.forEach(s => { if (s.category) cats.add(s.category); });
    return Array.from(cats);
  }, [surveys]);

  // Search Logic
  const results = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    if (!q) return { surveys: [], people: [], categories: [] };

    return {
      surveys: surveys.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category?.toLowerCase().includes(q)
      ),
      people: allPeople.filter(p => p.name.toLowerCase().includes(q)),
      categories: allCategories.filter(c => c.toLowerCase().includes(q))
    };
  }, [debouncedQuery, surveys, allPeople, allCategories]);

  // Filter Logic
  const showSurveys = (activeFilter === 'All' || activeFilter === 'Surveys' || activeFilter === 'Polls');
  const showPeople = (activeFilter === 'All' || activeFilter === 'People');
  const showCategories = (activeFilter === 'All' || activeFilter === 'Categories');

  // Specific filtering for Survey vs Poll within the Survey list
  const filteredSurveys = results.surveys.filter(s => {
    if (activeFilter === 'Surveys') return s.type === SurveyType.SURVEY;
    if (activeFilter === 'Polls') return s.type === SurveyType.POLL || s.type === SurveyType.TRENDING;
    return true;
  });

  const hasResults = filteredSurveys.length > 0 || results.people.length > 0 || results.categories.length > 0;

  const handleClearRecent = () => setRecentSearches([]);

  return (
    <div className="bg-white min-h-[100dvh] flex flex-col pb-20">
      {/* 1. Header & Input */}
      <div className="sticky top-0 bg-white z-20 px-4 py-3 border-b border-gray-100 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search surveys, polls, topics, or creators"
            className="w-full bg-gray-100 border-none rounded-2xl pl-10 pr-10 py-3.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 placeholder-gray-500 transition-all"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setDebouncedQuery(''); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full bg-gray-200 text-gray-500 hover:bg-gray-300"
            >
              <X size={14} strokeWidth={3} />
            </button>
          )}
        </div>

        {/* Filter Chips (Only show when searching) */}
        {query && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar mt-3 pb-1">
            {['All', 'Surveys', 'Polls', 'Categories', 'People'].map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter as any)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors border ${activeFilter === filter
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
              >
                {filter}
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
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Recent Searches</h3>
                  <button onClick={handleClearRecent} className="text-xs font-semibold text-blue-600 hover:text-blue-700">Clear</button>
                </div>
                <div className="space-y-1">
                  {recentSearches.map((term, idx) => (
                    <button
                      key={idx}
                      onClick={() => setQuery(term)}
                      className="flex items-center gap-3 w-full p-2.5 rounded-xl hover:bg-gray-50 text-left group transition-colors"
                    >
                      <Clock size={16} className="text-gray-400 group-hover:text-gray-600" />
                      <span className="text-sm text-gray-700 font-medium group-hover:text-gray-900">{term}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Trending Topics */}
            <section>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                <TrendingUp size={12} /> Trending Now
              </h3>
              <div className="flex flex-wrap gap-2">
                {['#RemoteWork', '#AI', '#Climate', '#CoffeeLover', '#TechTrends'].map(tag => (
                  <button
                    key={tag}
                    onClick={() => setQuery(tag.replace('#', ''))}
                    className="px-3.5 py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </section>

            {/* Popular Categories */}
            <section>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Browse Categories</h3>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setQuery('Technology')} className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white p-4 rounded-xl text-left shadow-sm hover:shadow-md transition-all">
                  <PieChart className="mb-2 opacity-80" size={20} />
                  <span className="font-bold text-sm block">Technology</span>
                </button>
                <button onClick={() => setQuery('Lifestyle')} className="bg-gradient-to-br from-orange-400 to-pink-500 text-white p-4 rounded-xl text-left shadow-sm hover:shadow-md transition-all">
                  <User className="mb-2 opacity-80" size={20} />
                  <span className="font-bold text-sm block">Lifestyle</span>
                </button>
              </div>
            </section>

            {/* All Users Directory */}
            <section>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Community</h3>
              <button
                onClick={() => (window as any).showUsersTable?.()}
                className="w-full flex items-center justify-between p-5 bg-white border border-blue-100 rounded-3xl hover:shadow-lg hover:shadow-blue-500/5 transition-all active:scale-[0.98] group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    <Users size={24} />
                  </div>
                  <div className="text-left">
                    <div className="font-bold text-gray-900">User Directory</div>
                    <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">View all members</div>
                  </div>
                </div>
                <ChevronRight size={20} className="text-gray-300 group-hover:text-blue-600 transition-colors" />
              </button>
            </section>
          </div>
        )}

        {/* State B: Live Results */}
        {query && (
          <div className="p-4 space-y-6">
            {!hasResults ? (
              <div className="flex flex-col items-center justify-center pt-12 text-center">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                  <Search size={24} className="text-gray-300" />
                </div>
                <h3 className="text-gray-900 font-bold mb-1">No results found</h3>
                <p className="text-sm text-gray-500">We couldn't find anything matching "{query}"</p>
              </div>
            ) : (
              <>
                {/* 1. Categories */}
                {showCategories && results.categories.length > 0 && (
                  <section className="animate-in fade-in slide-in-from-bottom-2">
                    {activeFilter === 'All' && <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Categories</h3>}
                    <div className="flex flex-wrap gap-2">
                      {results.categories.map(cat => (
                        <button
                          key={cat}
                          onClick={() => setQuery(cat)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-bold hover:border-blue-300 hover:text-blue-600"
                        >
                          <Hash size={12} className="text-gray-400" />
                          <HighlightedText text={cat} highlight={debouncedQuery} />
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* 2. People */}
                {showPeople && results.people.length > 0 && (
                  <section className="animate-in fade-in slide-in-in-from-bottom-2">
                    {activeFilter === 'All' && (
                      <div className="flex justify-between items-center mb-2 px-1">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Creators</h3>
                        {results.people.length > 3 && <button onClick={() => setActiveFilter('People')} className="text-xs text-blue-600 font-bold">See all</button>}
                      </div>
                    )}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      {(activeFilter === 'All' ? results.people.slice(0, 3) : results.people).map((person, i) => (
                        <div key={i} className="flex items-center justify-between p-3.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors">
                          <div className="flex items-center gap-3">
                            <img src={person.avatar} alt={person.name} className="w-10 h-10 rounded-full object-cover" />
                            <div>
                              <div className="text-sm font-bold text-gray-900"><HighlightedText text={person.name} highlight={debouncedQuery} /></div>
                              <div className="text-xs text-gray-500">Creator</div>
                            </div>
                          </div>
                          <button
                            onClick={() => onAuthorClick?.({ id: person.id, name: person.name, avatar: person.avatar })}
                            className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-bold hover:bg-gray-200">View</button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* 3. Surveys & Polls */}
                {showSurveys && filteredSurveys.length > 0 && (
                  <section className="animate-in fade-in slide-in-from-bottom-2">
                    {activeFilter === 'All' && <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Surveys & Polls</h3>}

                    <div className="space-y-3">
                      {filteredSurveys.map(survey => (
                        <div
                          key={survey.id}
                          onClick={() => onSurveyClick(survey.id, 'SEARCH')}
                          className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-3 active:scale-[0.99] transition-transform cursor-pointer"
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wide ${survey.type === SurveyType.POLL ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
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
                            {survey.coverImage && (
                              <img src={survey.coverImage} className="w-16 h-16 rounded-lg object-cover ml-3 bg-gray-100 shrink-0" alt="" />
                            )}
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-gray-50 mt-1">
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <img src={survey.author.avatar} className="w-4 h-4 rounded-full" alt="" />
                              <span>{survey.author.name}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-gray-400 font-medium">
                              <span>{survey.participants} votes</span>
                              <span>{survey.timeLeft}</span>
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
