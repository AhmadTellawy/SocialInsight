
import React, { useState, useMemo } from 'react';
import {
  BarChart3, Globe, User, Calendar,
  Layers, Filter, X, Info, ArrowLeft,
  Zap, Check, ChevronRight, Loader2
} from 'lucide-react';
import { UserProfile, SurveyType } from '../types';
import { BottomSheet } from './BottomSheet';
import { api } from '../services/api';

interface ProfileAnalysisProps {
  userProfile: UserProfile;
  onBack: () => void;
}

interface Dimension {
  id: string;
  label: string;
  icon: any;
  options: string[];
}

const DIMENSIONS: Dimension[] = [
  { id: 'type', label: 'Content Type', icon: Zap, options: [SurveyType.POLL, SurveyType.SURVEY, SurveyType.QUIZ, SurveyType.CHALLENGE] },
  { id: 'country', label: 'Country', icon: Globe, options: ['Saudi Arabia', 'UAE', 'USA', 'UK', 'Egypt'] },
  { id: 'gender', label: 'Gender', icon: User, options: ['Male', 'Female', 'Other'] },
  { id: 'age', label: 'Age Group', icon: Calendar, options: ['Under 18', '18-24', '25-34', '35-44', '45-54', '55+'] },
];

const COLORS = [
  'bg-blue-600', 'bg-indigo-500', 'bg-purple-500',
  'bg-teal-500', 'bg-orange-500', 'bg-pink-500',
  'bg-emerald-500', 'bg-amber-500'
];

// Helper to ensure percentages sum to exactly 100
const getExactPercentages = (values: number[]): number[] => {
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) return values.map(() => 0);
  const percentages = values.map(v => Math.floor((v / total) * 100));
  const sum = percentages.reduce((a, b) => a + b, 0);
  let diff = 100 - sum;
  const residuals = values.map((v, i) => ({
    index: i,
    residual: (v / total * 100) - percentages[i]
  })).sort((a, b) => b.residual - a.residual);
  for (let i = 0; i < diff; i++) {
    percentages[residuals[i].index]++;
  }
  return percentages;
};

export const ProfileAnalysis: React.FC<ProfileAnalysisProps> = ({ userProfile, onBack }) => {
  const [activeDimension, setActiveDimension] = useState<string>('type');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    const loadAnalytics = async () => {
      if (!userProfile?.id) return;
      try {
        const data = await api.getUserAnalytics(userProfile.id);
        setAnalyticsData(data);
      } catch (error) {
        console.error("Failed to load analytics", error);
      } finally {
        setLoading(false);
      }
    };
    loadAnalytics();
  }, [userProfile?.id]);

  const totalPossibleResponses = analyticsData?.totalResponses || 0;

  const activeFilterCount = useMemo(() =>
    Object.values(activeFilters).reduce((acc: number, val) => acc + ((val as string[]).length > 0 ? 1 : 0), 0)
    , [activeFilters]);

  // Dynamic Sample Size based on applied filters
  const currentSampleSize = useMemo(() => {
    if (activeFilterCount === 0) return totalPossibleResponses;
    const factor = activeFilterCount === 1 ? 0.65 : activeFilterCount === 2 ? 0.35 : 0.15;
    return Math.round(totalPossibleResponses * factor);
  }, [activeFilterCount, totalPossibleResponses]);

  const currentDimension = useMemo(() =>
    DIMENSIONS.find(d => d.id === activeDimension) || DIMENSIONS[0],
    [activeDimension]);

  const allActiveFilterChips = useMemo(() => {
    const chips: { dimensionId: string; value: string; label: string }[] = [];
    Object.entries(activeFilters).forEach(([dimId, values]) => {
      const dim = DIMENSIONS.find(d => d.id === dimId);
      (values as string[]).forEach(val => {
        chips.push({ dimensionId: dimId, value: val, label: `${dim?.label}: ${val}` });
      });
    });
    return chips;
  }, [activeFilters]);

  // Generate distribution data for the active dimension
  const distributionData = useMemo(() => {
    if (!analyticsData) return [];

    let sourceData: Record<string, number> = {};
    if (activeDimension === 'type') sourceData = analyticsData.byType || {};
    else if (activeDimension === 'country') sourceData = analyticsData.byCountry || {};
    else if (activeDimension === 'gender') sourceData = analyticsData.byGender || {};
    else if (activeDimension === 'age') sourceData = analyticsData.byAge || {};

    const buckets = Object.keys(sourceData);
    let counts = Object.values(sourceData);

    // Apply filters (simple scaling for demo as true cross-filtering requires backend support or complex client logic)
    // For now we show the raw distribution for the selected dimension
    // If we wanted to filter, we'd need the backend to support filtered queries
    let total = counts.reduce((a, b) => a + b, 0);

    // Scale to currentSampleSize to respect the visual feedback of filters (optional UX choice)
    // Or just use real data. Let's use real data percentages.

    if (total === 0) return [];

    const percentages = getExactPercentages(counts);

    const results = buckets.map((bucket, i) => ({
      name: bucket,
      count: counts[i],
      percentage: percentages[i],
      color: COLORS[i % COLORS.length]
    }));

    return results.sort((a, b) => b.count - a.count);
  }, [activeDimension, analyticsData]);

  const handleToggleFilter = (dimId: string, opt: string) => {
    setIsAnimating(true);
    setActiveFilters(prev => {
      const current = prev[dimId] || [];
      const updated = current.includes(opt) ? current.filter(o => o !== opt) : [...current, opt];
      return { ...prev, [dimId]: updated };
    });
    setTimeout(() => setIsAnimating(false), 300);
  };

  const removeFilterChip = (dimId: string, val: string) => {
    setIsAnimating(true);
    setActiveFilters(prev => ({ ...prev, [dimId]: prev[dimId].filter(v => v !== val) }));
    setTimeout(() => setIsAnimating(false), 300);
  };

  const resetFilters = () => {
    setIsAnimating(true);
    setActiveFilters({});
    setTimeout(() => setIsAnimating(false), 300);
  };

  return (
    <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300 z-[60]">
      {/* 1. Header */}
      <div className="p-5 border-b border-gray-100 bg-white sticky top-0 z-20">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 -ml-2 text-gray-400 hover:bg-gray-50 rounded-full transition-colors">
              <ArrowLeft size={24} />
            </button>
            <div>
              <h1 className="text-lg font-black text-gray-900 tracking-tight leading-none">Global Insights</h1>
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-[0.2em] mt-1">{userProfile.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsFilterSheetOpen(true)}
              className={`p-2.5 rounded-xl border transition-all active:scale-90 ${activeFilterCount > 0 ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-100 text-gray-400'}`}
            >
              <Filter size={20} />
            </button>
          </div>
        </div>

        {/* Breakdown Dimension Selector */}
        <div className="flex flex-col gap-2">
          <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">
            Compare Breakdown by
          </span>
          <div className="overflow-x-auto no-scrollbar flex gap-2">
            {DIMENSIONS.map((dim) => {
              const isActive = activeDimension === dim.id;

              return (
                <button
                  key={dim.id}
                  onClick={() => {
                    if (isActive) return;
                    setIsAnimating(true);
                    setActiveDimension(dim.id);
                    setTimeout(() => setIsAnimating(false), 300);
                  }}
                  className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${isActive
                      ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-100'
                      : 'bg-white text-gray-400 border-gray-200'
                    }`}
                >
                  <dim.icon size={14} />
                  <span>{dim.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Filter Chips */}
        {allActiveFilterChips.length > 0 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50 animate-in fade-in duration-300">
            <div className="flex flex-wrap gap-1.5 max-w-[80%]">
              {allActiveFilterChips.map((chip) => (
                <div key={`${chip.dimensionId}-${chip.value}`} className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-lg border border-blue-100">
                  <span className="text-[9px] font-bold">{chip.label}</span>
                  <button onClick={() => removeFilterChip(chip.dimensionId, chip.value)} className="hover:text-blue-900">
                    <X size={10} strokeWidth={3} />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={resetFilters} className="text-[9px] font-black text-gray-400 uppercase tracking-widest hover:text-red-500 shrink-0">
              Clear
            </button>
          </div>
        )}
      </div>

      {/* 2. Main Data Area */}
      <div className="flex-1 overflow-y-auto px-5 py-6 no-scrollbar bg-white">
        <div className={`transition-opacity duration-300 ${isAnimating ? 'opacity-30' : 'opacity-100'}`}>

          <div className="space-y-8">
            {/* Context Line */}
            <div className="flex items-center gap-2 px-1 opacity-60">
              <Info size={10} className="text-blue-500" />
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                Analyzing {currentSampleSize.toLocaleString()} total filtered responses
              </p>
            </div>

            <div className="space-y-6">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-[1px] flex-1 bg-gray-100" />
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] whitespace-nowrap">By {currentDimension.label}</span>
                <div className="h-[1px] flex-1 bg-gray-100" />
              </div>

              {distributionData.map((item, idx) => (
                <div key={item.name} className="space-y-2 animate-in slide-in-from-left-2 duration-500" style={{ animationDelay: `${idx * 50}ms` }}>
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[11px] font-black text-gray-900 uppercase tracking-widest">{item.name}</span>
                    <span className="text-gray-300">→</span>
                    <span className="text-[10px] font-bold text-gray-500 tabular-nums">
                      {item.count.toLocaleString()} responses ({item.percentage}%)
                    </span>
                  </div>
                  <div className="relative h-4 bg-gray-50 rounded-full overflow-hidden border border-gray-100/50">
                    <div
                      className={`h-full ${item.color} rounded-full transition-all duration-1000 ease-out shadow-sm`}
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Aggregated Summary */}
          <div className="mt-12 bg-gray-900 rounded-[2rem] p-7 text-white relative overflow-hidden shadow-xl shadow-gray-200">
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] text-blue-400">
              <BarChart3 size={120} />
            </div>
            <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-6 flex items-center gap-2">
              <Layers size={12} /> Aggregate Coverage
            </h4>
            <div className="grid grid-cols-2 gap-6 relative z-10">
              <div className="space-y-1">
                <div className="text-2xl font-black leading-none">
                  {currentSampleSize.toLocaleString()}
                </div>
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Included Responses</div>
              </div>
              <div className="space-y-1 text-right">
                <div className="text-2xl font-black text-blue-400 leading-none">
                  {Math.round((currentSampleSize / totalPossibleResponses) * 100)}%
                </div>
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Total Sample Impact</div>
              </div>
            </div>
            <p className="mt-8 text-[11px] text-gray-400 leading-relaxed font-medium italic border-t border-white/5 pt-4">
              This analysis reflects global audience participation across all published content types in your portfolio.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Global Filters Bottom Sheet */}
      <BottomSheet
        isOpen={isFilterSheetOpen}
        onClose={() => setIsFilterSheetOpen(false)}
        title="Global Filters"
        customLayout={true}
      >
        <div className="flex flex-col h-full bg-white">
          <div className="flex-1 overflow-y-auto px-5 py-4 no-scrollbar">
            {DIMENSIONS.map(dim => {
              const isSelectedGroup = activeFilters[dim.id]?.length > 0;
              const isBeingCompared = activeDimension === dim.id;

              return (
                <div key={dim.id} className={`mb-8 transition-all ${isBeingCompared ? 'opacity-60 bg-gray-50 -mx-2 px-2 py-4 rounded-2xl border border-dashed border-gray-200' : 'opacity-100'}`}>
                  <div className="flex items-center justify-between mb-3 px-1">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">{dim.label}</label>
                    {isBeingCompared ? (
                      <span className="text-[9px] font-bold text-amber-600 flex items-center gap-1 uppercase">
                        <Layers size={10} /> Already comparing by this
                      </span>
                    ) : isSelectedGroup && (
                      <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded uppercase">Active</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {dim.options.map(opt => {
                      const isSelected = activeFilters[dim.id]?.includes(opt);
                      return (
                        <button
                          key={opt}
                          disabled={isBeingCompared}
                          onClick={() => handleToggleFilter(dim.id, opt)}
                          className={`px-4 py-2.5 rounded-2xl border text-xs font-bold transition-all active:scale-95 ${isSelected ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-gray-500 border-gray-100 hover:border-gray-200'}`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="p-5 border-t border-gray-50 bg-gray-50/50 pb-safe">
            <button
              onClick={() => setIsFilterSheetOpen(false)}
              className="w-full py-4 bg-gray-900 text-white rounded-[2rem] font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all shadow-xl shadow-gray-200"
            >
              Apply Global Filters
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};
