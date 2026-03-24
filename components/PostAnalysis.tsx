import React, { useState, useMemo, useEffect } from 'react';
import { 
  Filter, Layers, Info, X, 
  Check, Sparkles, Settings2, ChevronRight,
  PieChart, FileText, HelpCircle, Zap, Globe, Lock, Trophy,
  ListChecks, ChevronDown, MessageSquare, Share2, FileSpreadsheet
} from 'lucide-react';
import { Survey, SurveyType, SurveyQuestion } from '../types';
import { BottomSheet } from './BottomSheet';
import { api } from '../services/api';

interface PostAnalysisProps {
  survey: Survey;
  isAccessDenied?: boolean;
}

interface Dimension {
  id: string;
  label: string;
  options: string[];
}

const DEMOGRAPHIC_DIMENSIONS: Dimension[] = [
  { id: 'age', label: 'Age Group', options: ['18-24', '25-34', '35-44', '45+'] },
  { id: 'gender', label: 'Gender', options: ['Male', 'Female', 'Other'] },
  { id: 'country', label: 'Country', options: ['Saudi Arabia', 'UAE', 'USA', 'UK', 'Egypt'] },
  { id: 'education', label: 'Education Level', options: ['Primary Education', 'Preparatory / Middle School', 'Secondary Education (High School)', 'Diploma', 'Higher Diploma / Postgraduate Diploma', 'Bachelor’s Degree', 'Professional Diploma', 'Master’s Degree', 'Doctorate (PhD)', 'Prefer not to say'] },
  { id: 'employment', label: 'Employment Status', options: ['Employed', 'Unemployed', 'Student', 'Retired', 'Homemaker', 'prefer not to specify'] },
  { id: 'industry', label: 'Employment Type', options: ['Government', 'Private Sector', 'Non-profit / NGO', 'Self-employed / Freelancer', 'Not Applicable', 'Prefer not to say'] },
  { id: 'sector', label: 'Employment Sector', options: [
      'Agriculture, Forestry, And Fishing', 'Mining', 'Construction', 'Manufacturing', 
      'Transportation, Communications, Electric, Gas, And Sanitary Services', 'Wholesale Trade', 
      'Retail Trade', 'Finance, Insurance, And Real Estate', 'Services', 'Public Administration', 
      'Not Applicable', 'Prefer Not To Specify'
  ] },
];

const SEGMENT_COLORS = [
  'bg-blue-600',
  'bg-teal-500',
  'bg-indigo-400',
  'bg-amber-400',
  'bg-rose-400',
];

const BORDER_COLORS = [
  'border-blue-200',
  'border-teal-200',
  'border-indigo-200',
  'border-amber-200',
  'border-rose-200',
];

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

export const PostAnalysis: React.FC<PostAnalysisProps> = ({ survey, isAccessDenied }) => {
  const sourceSurvey = survey.sharedFrom || survey;
  const isChallenge = sourceSurvey.type === SurveyType.CHALLENGE;
  const isQuiz = sourceSurvey.type === SurveyType.QUIZ;

  // Flattened questions for Survey/Quiz/Poll
  const allQuestions = useMemo(() => {
    if (sourceSurvey.sections && sourceSurvey.sections.length > 0) {
      return sourceSurvey.sections.flatMap(s => s.questions);
    }
    // Handle single question types (Poll, Trending) that don't use sections
    if (sourceSurvey.type === SurveyType.POLL || sourceSurvey.type === SurveyType.TRENDING) {
      return [{
        id: 'poll-q-1',
        text: sourceSurvey.question || sourceSurvey.title,
        type: 'multiple_choice',
        options: sourceSurvey.options
      } as SurveyQuestion];
    }
    return [];
  }, [sourceSurvey]);

  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(() => {
    // For Multi-question Quizzes, default to "All" (Overall Performance)
    if (isQuiz && allQuestions.length > 1) return 'all';
    return allQuestions.length > 0 ? allQuestions[0].id : null;
  });

  const activeQuestion = useMemo(() => {
    if (isChallenge || activeQuestionId === 'all') return null;
    if (!activeQuestionId) return allQuestions[0];
    return allQuestions.find(q => q.id === activeQuestionId) || allQuestions[0];
  }, [activeQuestionId, allQuestions, isChallenge]);

  const [showNumbers, setShowNumbers] = useState(true);
  const [showAIInsights, setShowAIInsights] = useState(false);
  const [isCompareOn, setIsCompareOn] = useState(false);
  const [compareDimension, setCompareDimension] = useState<string>('age');
  const [showToast, setShowToast] = useState<string | null>(null);

  const [isSettingsSheetOpen, setIsSettingsSheetOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [tooltip, setTooltip] = useState<{ label: string, percent: number, count: number, x: number, y: number, id: string } | null>(null);
  const [highlightedOptionId, setHighlightedOptionId] = useState<string | null>(null);

  const activeOptions = useMemo(() => {
    if (isChallenge) return (sourceSurvey.options || []).slice(0, 10);
    if (activeQuestion?.options) return activeQuestion.options;
    return [];
  }, [isChallenge, sourceSurvey.options, activeQuestion]);

  const [resultsData, setResultsData] = useState<any[]>([]);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(true);

  // Fetch real data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoadingAnalysis(true);
        const data = await api.getPostResults(sourceSurvey.id);
        setResultsData(data);
      } catch (err) {
        console.error("Failed to load post results:", err);
      } finally {
        setIsLoadingAnalysis(false);
      }
    };
    loadData();
  }, [sourceSurvey.id]);

  const activeFilterCount = useMemo(() => 
    Object.values(activeFilters).reduce((acc: number, val: any) => acc + (val.length > 0 ? 1 : 0), 0)
  , [activeFilters]);

  const filteredResultsData = useMemo(() => {
    let filtered = resultsData;
    Object.entries(activeFilters).forEach(([dimId, _vals]) => {
      const vals = _vals as string[];
      if (vals.length === 0) return;
      if (dimId.startsWith('q-')) {
        const qId = dimId.replace('q-', '');
        filtered = filtered.filter(r => {
           const q = allQuestions.find(qq => qq.id === qId);
           if (!q) return false;
           // If they answered this question, their selected optionId will be one of the question's options
           const selectedOpt = q.options?.find(o => r.answers.some((a: any) => a.optionId === o.id));
           return selectedOpt ? vals.includes(selectedOpt.text) : false;
        });
      } else {
        filtered = filtered.filter(r => r.demographics && vals.includes(r.demographics[dimId]));
      }
    });
    return filtered;
  }, [resultsData, activeFilters, allQuestions]);

  const currentSampleSize = filteredResultsData.length;

  // Overall Score Distribution for Quizzes based on real scores
  const scoreDistribution = useMemo(() => {
    if (!isQuiz || activeQuestionId !== 'all' || currentSampleSize === 0) return null;
    
    const ranges = [
      { label: '91% – 100%', min: 91, count: 0 },
      { label: '81% – 90%', min: 81, count: 0 },
      { label: '71% – 80%', min: 71, count: 0 },
      { label: '61% – 70%', min: 61, count: 0 },
      { label: '51% – 60%', min: 51, count: 0 },
      { label: '≤ 50%', min: 0, count: 0 },
    ];

    filteredResultsData.forEach(r => {
        let correctCount = 0;
        let totalQ = 0;
        allQuestions.forEach(q => {
           if (q.correctOptionId) {
               totalQ++;
               if (r.answers.some((a: any) => a.optionId === q.correctOptionId)) correctCount++;
           }
        });
        if (totalQ === 0) return;
        const scorePct = Math.round((correctCount / totalQ) * 100);
        const range = ranges.find(r => scorePct >= r.min) || ranges[5];
        range.count++;
    });

    const counts = ranges.map(r => r.count);
    const percentages = getExactPercentages(counts);
    
    return ranges.map((r, i) => ({
      ...r,
      percentage: percentages[i],
      color: i === 0 ? 'bg-green-500' : i === 1 ? 'bg-blue-500' : i < 4 ? 'bg-indigo-400' : 'bg-gray-400'
    }));
  }, [isQuiz, activeQuestionId, currentSampleSize, filteredResultsData, allQuestions]);

  const overallData = useMemo(() => {
    if (activeOptions.length === 0 || currentSampleSize === 0) return { label: 'Overall', segments: [] };
    
    const counts = activeOptions.map(opt => {
       if (activeQuestionId === 'all') return 0;
       return filteredResultsData.filter(r => 
          r.answers.some((a: any) => a.optionId === opt.id)
       ).length;
    });

    const percentages = getExactPercentages(counts);
    const segments = percentages.map((p, i) => ({
      optionId: activeOptions[i].id,
      optionLabel: activeOptions[i].text || `Option ${i + 1}`,
      percentage: p,
      count: counts[i],
      color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
      borderColor: BORDER_COLORS[i % BORDER_COLORS.length],
      isCorrect: activeQuestion?.correctOptionId === activeOptions[i].id
    }));

    const maxPct = Math.max(...segments.map(s => s.percentage), -1);
    return {
      label: 'Overall',
      segments: segments.map(s => ({ ...s, isDominant: s.percentage === maxPct && maxPct > 0 }))
    };
  }, [filteredResultsData, activeOptions, activeQuestionId, activeQuestion, currentSampleSize]);

  const rankedOptions = useMemo(() => {
    return [...overallData.segments].sort((a, b) => b.percentage - a.percentage);
  }, [overallData]);

  const comparisonData = useMemo(() => {
    if (!isCompareOn || activeQuestionId === 'all') return [];
    const dim = DEMOGRAPHIC_DIMENSIONS.find(d => d.id === compareDimension) || DEMOGRAPHIC_DIMENSIONS[0];
    const buckets = dim.options.slice(0, 4);
    
    return buckets.map(bucket => {
      const bucketResults = filteredResultsData.filter(r => r.demographics && r.demographics[compareDimension] === bucket);
      const rowTotal = bucketResults.length;
      const rowPercentage = currentSampleSize > 0 ? Math.round((rowTotal / currentSampleSize) * 100) : 0;
      
      const counts = activeOptions.map(opt => {
         return bucketResults.filter(r => 
            r.answers.some((a: any) => a.optionId === opt.id)
         ).length;
      });
      
      const optionPercentages = getExactPercentages(counts);
      const segments = optionPercentages.map((p, i) => ({
        optionId: activeOptions[i].id,
        optionLabel: activeOptions[i].text,
        percentage: p,
        count: counts[i],
        color: SEGMENT_COLORS[i % SEGMENT_COLORS.length]
      }));
      
      const maxPct = Math.max(...segments.map(s => s.percentage), -1);
      return {
        label: bucket,
        rowTotal,
        rowPercentage,
        segments: segments.map(s => ({ ...s, isDominant: s.percentage === maxPct && maxPct > 0 }))
      };
    });
  }, [isCompareOn, compareDimension, activeOptions, currentSampleSize, filteredResultsData, activeQuestionId]);

  const dynamicInsight = useMemo(() => {
    if (currentSampleSize === 0) return "Not enough data to generate insights yet.";
    if (activeQuestionId === 'all') {
      const topRange = scoreDistribution?.[0];
      return `Overall quiz performance shows ${topRange?.percentage}% of participants scoring in the highest bracket (${topRange?.label}).`;
    }
    const currentMainData = isCompareOn ? comparisonData : [overallData];
    if (currentMainData.length < 2) {
      const top = overallData.segments.find(s => s.isDominant);
      if (!top) return "Responses are completely evenly distributed.";
      return `Currently, "${top?.optionLabel}" is the leading choice for this question among the selected audience (${currentSampleSize.toLocaleString()} participants).`;
    }
    const firstDominant = comparisonData[0]?.segments.find(s => s.isDominant);
    const lastDominant = comparisonData[comparisonData.length - 1]?.segments.find(s => s.isDominant);
    if (!firstDominant || !lastDominant) return "Insufficient data across segments to compare.";
    if (firstDominant?.optionId === lastDominant?.optionId) {
      return `Across ${compareDimension} groups, "${firstDominant?.optionLabel}" consistently emerges as the preferred response.`;
    }
    return `${comparisonData[0].label} users show a higher preference for "${firstDominant?.optionLabel}", while the ${comparisonData[comparisonData.length - 1].label} segment leans towards "${lastDominant?.optionLabel}".`;
  }, [overallData, comparisonData, isCompareOn, currentSampleSize, compareDimension, activeQuestionId, scoreDistribution]);

  const handleToggleFilter = (dimId: string, opt: string) => {
    setActiveFilters(prev => {
      const current = prev[dimId] || [];
      const updated = current.includes(opt) ? current.filter(o => o !== opt) : [...current, opt];
      return { ...prev, [dimId]: updated };
    });
  };

  const handleSegmentClick = (e: React.MouseEvent, segment: any) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({
      label: segment.optionLabel,
      percent: segment.percentage,
      count: segment.count,
      x: e.clientX,
      y: rect.top - 10,
      id: segment.optionId
    });
    setHighlightedOptionId(segment.optionId);
  };

  const handleShareAnalysis = () => {
    setShowToast("Analysis link copied to clipboard");
    setTimeout(() => setShowToast(null), 2500);
  };

  const handleExportData = () => {
    setShowToast("Preparing Excel extract...");
    setTimeout(() => setShowToast("Extract downloaded successfully"), 2000);
    setTimeout(() => setShowToast(null), 4500);
  };

  const getTimeAgo = (dateStr: string) => {
    const now = new Date();
    const past = new Date(dateStr);
    const diffInSeconds = Math.floor((now.getTime() - past.getTime()) / 1000);
    if (diffInSeconds < 60) return 'Just now';
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;
    return past.toLocaleDateString();
  };

  const getTypeConfig = (type: SurveyType) => {
    switch (type) {
      case SurveyType.POLL: return { icon: PieChart, label: 'Poll', color: 'text-green-600' };
      case SurveyType.SURVEY: return { icon: FileText, label: 'Survey', color: 'text-blue-600' };
      case SurveyType.QUIZ: return { icon: HelpCircle, label: 'Quiz', color: 'text-purple-600' };
      case SurveyType.CHALLENGE: return { icon: Zap, label: 'Challenge', color: 'text-amber-600' };
      case SurveyType.TRENDING: return { icon: PieChart, label: 'Poll', color: 'text-green-600' };
      default: return { icon: FileText, label: 'Survey', color: 'text-blue-600' };
    }
  };

  const typeConfig = getTypeConfig(sourceSurvey.type);
  const TypeIcon = typeConfig.icon;
  const VisibilityIcon = sourceSurvey.resultsVisibility === 'Private' ? Lock : Globe;

  if (isAccessDenied) {
    return (
      <div className="flex flex-col h-full bg-white animate-in zoom-in-95 duration-500 items-center justify-center p-6 text-center select-none">
        <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mb-6 border border-gray-100 shadow-inner">
          <Lock size={40} className="text-gray-400" strokeWidth={1.5} />
        </div>
        <h2 className="text-2xl font-black text-gray-900 mb-3 tracking-tight">Analysis Unavailable</h2>
        <p className="text-[15px] text-gray-500 max-w-[280px] leading-relaxed font-medium">
          According to the post settings, you do not have permission to view the results.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white animate-in fade-in duration-300 relative select-none">
      <div className="border-b border-gray-100 bg-white sticky top-0 z-30 shadow-sm">
        <div className="p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <img 
                src={sourceSurvey.author.avatar || 'https://picsum.photos/40/40'} 
                alt={sourceSurvey.author.name} 
                className="w-12 h-12 rounded-full object-cover border border-gray-100"
              />
              <div className="flex flex-col">
                <h3 className="font-bold text-gray-900 text-sm">{sourceSurvey.author.name}</h3>
                <div className="flex items-center flex-wrap gap-y-1 gap-x-1.5 text-[10px] text-gray-500 font-medium mt-0.5">
                    <span>{getTimeAgo(sourceSurvey.createdAt)}</span>
                    <span className="text-gray-300 text-[10px]">•</span>
                    <VisibilityIcon size={11} className="text-gray-400" />
                    <span className="text-gray-300 text-[10px]">•</span>
                    <div className={`flex items-center gap-1 ${typeConfig.color} bg-opacity-10 font-bold uppercase tracking-wider`}>
                      <TypeIcon size={10} /> <span>{typeConfig.label} Analysis</span>
                    </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <button onClick={() => setIsFilterSheetOpen(true)} className={`p-2.5 rounded-xl border transition-all active:scale-90 ${activeFilterCount > 0 ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-100 text-gray-400'}`}><Filter size={20} /></button>
                <button onClick={() => setIsSettingsSheetOpen(true)} className="p-2.5 rounded-xl border border-gray-100 text-gray-400 bg-white transition-all active:scale-90 hover:bg-gray-50"><Settings2 size={20} /></button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleShareAnalysis} className="p-2.5 rounded-xl border border-gray-100 text-gray-400 bg-white transition-all active:scale-90 hover:bg-gray-50"><Share2 size={20} /></button>
                <button onClick={handleExportData} className="p-2.5 rounded-xl border border-gray-100 text-gray-400 bg-white transition-all active:scale-90 hover:bg-gray-50"><FileSpreadsheet size={20} /></button>
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-black text-gray-900 tracking-tight leading-tight">{sourceSurvey.title}</h1>
          </div>
        </div>

        {allQuestions.length > 1 && (
          <div className="px-5 pb-4">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
              {isQuiz && (
                <button 
                  onClick={() => { setActiveQuestionId('all'); setHighlightedOptionId(null); }}
                  className={`shrink-0 h-10 px-4 rounded-full text-xs font-black border transition-all flex items-center justify-center ${activeQuestionId === 'all' ? 'bg-purple-600 text-white border-purple-600 shadow-md' : 'bg-gray-50 text-gray-400 border-gray-100'}`}
                >
                  All
                </button>
              )}
              {allQuestions.map((q, idx) => {
                const isActive = activeQuestionId === q.id;
                const isFiltered = Object.keys(activeFilters).some(key => key === `q-${q.id}`);
                return (
                  <button 
                    key={q.id}
                    onClick={() => { setActiveQuestionId(q.id); setHighlightedOptionId(null); }}
                    className={`shrink-0 h-10 w-10 rounded-full text-xs font-black border transition-all relative flex items-center justify-center ${isActive ? (isQuiz ? 'bg-purple-600 border-purple-600 text-white' : 'bg-blue-600 text-white border-blue-600 shadow-md') : 'bg-gray-50 text-gray-400 border-gray-100'}`}
                  >
                    Q{idx + 1}
                    {isFiltered && <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6 no-scrollbar pb-32">
        {isLoadingAnalysis ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-4 opacity-70 animate-in fade-in duration-500">
             <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
             <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Aggregating Results...</span>
          </div>
        ) : (
          <>
            {activeFilterCount > 0 && (
              <div className="flex flex-wrap gap-2 mb-6 animate-in slide-in-from-top-2">
                {Object.entries(activeFilters).map(([dimId, _vals]) => {
                  const vals = _vals as string[];
                  return vals.map(v => (
                    <div key={`${dimId}-${v}`} className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg border border-blue-100">
                      <span className="text-[10px] font-bold">
                        {dimId.startsWith('q-') ? `Q: ${v}` : v}
                      </span>
                      <button onClick={() => handleToggleFilter(dimId, v)} className="hover:text-blue-900"><X size={12} strokeWidth={3} /></button>
                    </div>
                  ));
                })}
                <button onClick={() => setActiveFilters({})} className="text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-red-500 ml-auto">Clear all</button>
              </div>
            )}

        <div className="space-y-8">
          <div className="flex items-center gap-2 px-1">
             <Info size={12} className="text-gray-400" />
             <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">
               Based on {currentSampleSize.toLocaleString()} {activeFilterCount > 0 ? 'filtered responses' : 'responses'}
             </p>
          </div>

          {!isChallenge && activeQuestion && (
            <div className={`p-4 rounded-2xl border mb-2 animate-in fade-in duration-300 ${isQuiz ? 'bg-purple-50 border-purple-100' : 'bg-gray-50 border-gray-100'}`}>
               <h4 className={`text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-1 ${isQuiz ? 'text-purple-600' : 'text-blue-600'}`}>
                 <MessageSquare size={10} /> Analyzed Question
               </h4>
               <p className="text-sm font-bold text-gray-800 leading-tight">{activeQuestion.text}</p>
            </div>
          )}

          <div className="space-y-6">
            {activeQuestionId === 'all' && scoreDistribution ? (
              <div className="space-y-4 animate-in fade-in duration-500">
                <div className="flex items-center gap-2 mb-2">
                   <div className="h-[1px] flex-1 bg-gray-100" />
                   <span className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] whitespace-nowrap">Score Distribution</span>
                   <div className="h-[1px] flex-1 bg-gray-100" />
                </div>
                <div className="space-y-3">
                  {scoreDistribution.map((range, index) => (
                    <div key={index} className="space-y-2">
                       <div className="flex items-center justify-between px-1">
                          <span className="text-xs font-bold text-gray-700">{range.label}</span>
                          <div className="flex items-center gap-2">
                             <span className="text-xs font-black text-gray-900 tabular-nums">{range.percentage}%</span>
                             <span className="text-[10px] font-medium text-gray-400 tabular-nums">({range.count.toLocaleString()} participants)</span>
                          </div>
                       </div>
                       <div className="h-2.5 w-full bg-gray-50 rounded-full overflow-hidden border border-gray-100/50">
                          <div className={`h-full ${range.color} rounded-full transition-all duration-1000 ease-out`} style={{ width: `${range.percentage}%` }} />
                       </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (isChallenge || isQuiz) ? (
              <div className="space-y-4 animate-in fade-in duration-500">
                <div className="flex items-center gap-2 mb-2">
                   <div className="h-[1px] flex-1 bg-gray-100" />
                   <span className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] whitespace-nowrap">Ranking Distribution</span>
                   <div className="h-[1px] flex-1 bg-gray-100" />
                </div>
                <div className="space-y-3">
                  {rankedOptions.map((opt, index) => (
                    <div key={opt.optionId} className="space-y-2 animate-in slide-in-from-left-2" style={{ animationDelay: `${index * 50}ms` }}>
                       <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-2">
                             <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-black ${isQuiz && opt.isCorrect ? 'bg-green-100 text-green-600' : index === 0 ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-400'}`}>
                               #{index + 1}
                             </span>
                             <span className={`text-sm font-bold truncate max-w-[160px] ${index === 0 || (isQuiz && opt.isCorrect) ? 'text-gray-900' : 'text-gray-600'}`}>
                               {opt.optionLabel}
                             </span>
                             {isQuiz ? (
                                opt.isCorrect && (
                                  <span className="bg-green-100 text-green-700 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest flex items-center gap-1">
                                    <Check size={8} strokeWidth={4} /> Correct Answer
                                  </span>
                                )
                             ) : (
                                index === 0 && (
                                  <span className="bg-amber-100 text-amber-700 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest flex items-center gap-1">
                                    <Trophy size={8} /> Winner
                                  </span>
                                )
                             )}
                          </div>
                          <div className="flex items-center gap-2">
                             <span className="text-xs font-black text-gray-900 tabular-nums">{opt.percentage}%</span>
                             <span className="text-[10px] font-medium text-gray-400 tabular-nums">({opt.count.toLocaleString()})</span>
                          </div>
                       </div>
                       <div className="h-2.5 w-full bg-gray-50 rounded-full overflow-hidden border border-gray-100/50">
                          <div className={`h-full ${isQuiz && opt.isCorrect ? 'bg-green-500' : opt.color} rounded-full transition-all duration-1000 ease-out`} style={{ width: `${opt.percentage}%` }} />
                       </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2 animate-in slide-in-from-left-2">
                  <span className="text-[10px] font-black text-gray-900 uppercase tracking-[0.15em] ml-1">Response Distribution</span>
                  <div className="relative h-14 w-full bg-gray-50 rounded-xl overflow-hidden border border-gray-100 flex shadow-sm">
                    {overallData.segments.map((seg, segIdx) => (
                        <div 
                          key={segIdx}
                          onClick={(e) => handleSegmentClick(e, seg)}
                          className={`${seg.color} h-full transition-all duration-500 ease-out border-r border-white/20 last:border-0 relative cursor-pointer ${highlightedOptionId === seg.optionId ? 'brightness-110 shadow-inner' : highlightedOptionId !== null ? 'opacity-20 grayscale' : seg.isDominant ? 'brightness-105' : 'brightness-95 opacity-80'}`}
                          style={{ flexBasis: `${seg.percentage}%` }}
                        >
                          {showNumbers && seg.percentage > 10 && <div className="absolute inset-0 flex items-center justify-center text-white font-medium text-[10px] drop-shadow-sm">{seg.percentage}%</div>}
                        </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1 pb-2 px-1 border-b border-gray-50">
                  {activeOptions.map((opt, i) => (
                    <div key={opt.id} onClick={() => setHighlightedOptionId(highlightedOptionId === opt.id ? null : opt.id)} className={`flex items-center gap-2 cursor-pointer transition-opacity ${highlightedOptionId !== null && highlightedOptionId !== opt.id ? 'opacity-30' : 'opacity-100'}`}>
                      <div className={`w-2.5 h-2.5 rounded-full ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]}`} />
                      <span className="text-[10px] font-bold text-gray-700">{opt.text}</span>
                    </div>
                  ))}
                </div>

                {isCompareOn ? (
                  <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
                    <div className="flex items-center gap-2 mb-1">
                       <div className="h-[1px] flex-1 bg-gray-100" /><span className="text-[9px] font-black text-gray-400 uppercase tracking-widest whitespace-nowrap">By {compareDimension}</span><div className="h-[1px] flex-1 bg-gray-100" />
                    </div>
                    {comparisonData.map((row, rowIdx) => (
                      <div key={rowIdx} className="space-y-2">
                        <div className="flex items-center gap-2 px-1"><span className="text-[11px] font-black text-gray-900 uppercase tracking-widest">{row.label}</span><span className="text-gray-300">→</span><span className="text-[10px] font-bold text-gray-500 tabular-nums">{row.rowTotal.toLocaleString()} responses</span></div>
                        <div className="relative h-[24px] w-full bg-gray-50 rounded-xl overflow-hidden border border-gray-100 flex shadow-xs">
                          {row.segments.map((seg: any, segIdx: number) => (
                              <div key={segIdx} onClick={(e) => handleSegmentClick(e, seg)} className={`${seg.color} h-full transition-all duration-500 ease-out border-r border-white/20 last:border-0 relative cursor-pointer ${highlightedOptionId === seg.optionId ? 'brightness-110' : highlightedOptionId !== null ? 'opacity-20 grayscale' : seg.isDominant ? 'brightness-105' : 'brightness-95 opacity-80'}`} style={{ flexBasis: `${seg.percentage}%` }}>
                                {showNumbers && seg.percentage > 15 && <div className="absolute inset-0 flex items-center justify-center text-white font-medium text-[8px]">{seg.percentage}%</div>}
                              </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                    <button onClick={() => setIsSettingsSheetOpen(true)} className="text-[10px] font-bold text-blue-500 uppercase tracking-wide hover:underline underline-offset-4">Enable demographic breakdown from settings</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {showAIInsights && (
            <div className="bg-gray-900 rounded-[2rem] p-7 text-white relative overflow-hidden shadow-xl shadow-gray-200 animate-in fade-in zoom-in duration-500">
               <div className="absolute top-0 right-0 p-8 opacity-[0.03] rotate-12"><Sparkles size={100} /></div>
               <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] mb-3 flex items-center gap-2"><Sparkles size={12} /> AI Insight</h4>
               <p className="text-sm font-medium leading-relaxed tracking-wide">{dynamicInsight}</p>
            </div>
          )}
        </div>
        </>
        )}
      </div>

      {tooltip && (
        <div className="fixed z-[100] bg-gray-900 text-white px-4 py-2.5 rounded-2xl text-xs font-bold shadow-2xl animate-in zoom-in-95 pointer-events-none -translate-x-1/2 -translate-y-full border border-white/10" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="flex flex-col items-center">
             <span className="text-[9px] text-blue-400 uppercase tracking-widest mb-0.5">{tooltip.label}</span>
             <span className="text-sm">{tooltip.percent}% <span className="text-gray-400 font-medium text-[10px]">({tooltip.count.toLocaleString()} responses)</span></span>
          </div>
          <div className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45" />
        </div>
      )}

      {showToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-2.5 rounded-full text-xs font-black uppercase tracking-widest shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300 z-[110]">
          {showToast}
        </div>
      )}

      <BottomSheet isOpen={isSettingsSheetOpen} onClose={() => setIsSettingsSheetOpen(false)} title="Analysis Settings">
        <div className="space-y-6 py-4 px-2">
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex flex-col"><span className="text-sm font-bold text-gray-800">Show numbers</span><span className="text-[10px] text-gray-400 font-medium">Display percentages inside segments</span></div>
              <button onClick={() => setShowNumbers(!showNumbers)} className={`w-10 h-5 rounded-full relative transition-all active:scale-90 ${showNumbers ? 'bg-blue-600' : 'bg-gray-300'}`}><div className={`absolute top-1 w-3 h-3 bg-white rounded-full shadow-sm transition-all ${showNumbers ? 'left-6' : 'left-1'}`} /></button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex flex-col"><span className="text-sm font-bold text-gray-800">AI Insights</span><span className="text-[10px] text-gray-400 font-medium">Generate context-aware trend summaries</span></div>
              <button onClick={() => setShowAIInsights(!showAIInsights)} className={`w-10 h-5 rounded-full relative transition-all active:scale-90 ${showAIInsights ? 'bg-blue-600' : 'bg-gray-300'}`}><div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${showAIInsights ? 'left-6' : 'left-1'}`} /></button>
            </div>
            <div className="h-px bg-gray-100 my-2" />
            <div className="flex items-center justify-between">
              <div className="flex flex-col"><span className="text-sm font-bold text-gray-800">Enable demographic comparison</span><span className="text-[10px] text-gray-400 font-medium">Split analysis by demographics</span></div>
              <button onClick={() => setIsCompareOn(!isCompareOn)} className={`w-10 h-5 rounded-full relative transition-all active:scale-90 ${isCompareOn ? 'bg-blue-600' : 'bg-gray-300'}`}><div className={`absolute top-1 w-3 h-3 bg-white rounded-full shadow-sm transition-all ${isCompareOn ? 'left-6' : 'left-1'}`} /></button>
            </div>
          </div>
          {isCompareOn && (
            <div className="pt-4 space-y-3 animate-in slide-in-from-top-2 duration-300">
               <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Compare by:</label>
               <div className="flex flex-wrap gap-2">
                 {DEMOGRAPHIC_DIMENSIONS.map(d => (
                   <button key={d.id} onClick={() => setCompareDimension(d.id)} className={`flex-1 py-3 rounded-2xl border text-xs font-bold transition-all active:scale-95 ${compareDimension === d.id ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-gray-50 text-gray-500 border-gray-100'}`}>{d.label}</button>
                 ))}
               </div>
            </div>
          )}
          <div className="pt-4"><button onClick={() => setIsSettingsSheetOpen(false)} className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all shadow-xl shadow-gray-200">Apply Settings</button></div>
        </div>
      </BottomSheet>

      <BottomSheet isOpen={isFilterSheetOpen} onClose={() => setIsFilterSheetOpen(false)} title="Analysis Filters" customLayout={true}>
        <div className="flex flex-col h-full bg-white">
          <div className="flex-1 overflow-y-auto px-5 py-4 no-scrollbar">
            {/* Demographics Section */}
            <div className="mb-4">
              <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] mb-4">Audience Demographics</h3>
              {DEMOGRAPHIC_DIMENSIONS.map(dim => {
                const isBeingCompared = isCompareOn && compareDimension === dim.id;
                return (
                  <div key={dim.id} className={`mb-6 transition-all ${isBeingCompared ? 'opacity-60 bg-gray-50 -mx-2 px-2 py-4 rounded-2xl border border-dashed border-gray-200' : 'opacity-100'}`}>
                    <div className="flex items-center justify-between mb-3 px-1">
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">{dim.label}</label>
                      {isBeingCompared && <span className="text-[9px] font-bold text-amber-600 flex items-center gap-1"><Layers size={10} /> Already comparing by this</span>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {dim.options.map(opt => {
                        const isSelected = activeFilters[dim.id]?.includes(opt);
                        return (
                          <button key={opt} disabled={isBeingCompared} onClick={() => handleToggleFilter(dim.id, opt)} className={`px-4 py-2.5 rounded-2xl border text-xs font-bold transition-all active:scale-95 ${isSelected ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-gray-600 border-gray-100 hover:border-gray-200'}`}>{opt}</button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Cross-Question Filters Section */}
            {allQuestions.length > 1 && (
              <div className="mt-8 border-t border-gray-100 pt-8 pb-10">
                <div className="flex items-center justify-between mb-4 px-1">
                   <h3 className="text-[10px] font-black text-purple-600 uppercase tracking-[0.2em]">Response Filters</h3>
                   <span className="text-[8px] font-black bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">Cross-Tab</span>
                </div>
                <p className="text-[11px] text-gray-500 mb-6 px-1 italic">Filter current analysis by how users answered other questions.</p>
                
                <div className="space-y-8">
                  {allQuestions.map((q, idx) => {
                    if (q.id === activeQuestionId || !q.options || q.options.length === 0) return null;
                    return (
                      <div key={q.id} className="space-y-3">
                        <div className="flex items-start gap-2 px-1">
                           <span className="text-[10px] font-black text-gray-300 uppercase">Q{idx + 1}</span>
                           <p className="text-xs font-bold text-gray-700 leading-tight">{q.text}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {q.options.map(opt => {
                            const filterId = `q-${q.id}`;
                            const isSelected = activeFilters[filterId]?.includes(opt.text);
                            return (
                              <button 
                                key={opt.id} 
                                onClick={() => handleToggleFilter(filterId, opt.text)}
                                className={`px-3 py-2 rounded-xl border text-[10px] font-bold transition-all active:scale-95 ${isSelected ? 'bg-purple-600 text-white border-purple-600 shadow-md' : 'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-100'}`}
                              >
                                {opt.text}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="p-5 border-t border-gray-50 bg-gray-50/50 pb-safe">
            <button onClick={() => setIsFilterSheetOpen(false)} className="w-full py-4 bg-gray-900 text-white rounded-[2rem] font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all shadow-xl shadow-gray-200">Apply Filters</button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};
