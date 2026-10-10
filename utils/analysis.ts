export const analysisDimensions = ['country', 'gender', 'age', 'marital', 'education', 'employment', 'industry', 'sector', 'nationality'] as const;
export type AnalysisDimension = typeof analysisDimensions[number];
export type AnalysisFilters = Partial<Record<AnalysisDimension, string[]>>;
export type QuestionSummary = { questionId: string; responseCount: number; optionCounts: Record<string, number>; textResponseCount: number };
export type AnalysisGroup = QuestionSummary & { label: string };
export type AnalysisResults = {
  version: 3; sampleSize: number | null; minimumCellSize: number; suppressionReason: string | null;
  questionSummaries: QuestionSummary[]; filterOptions: Partial<Record<AnalysisDimension, string[]>>;
  demographicSuppressionReason: string | null;
  scoreDistribution?: { counts: Record<string, number>; suppressionReason: string | null } | null;
  comparison: null | { dimension: AnalysisDimension; questionId?: string; suppressionReason: string | null; overall: QuestionSummary | null; groups: AnalysisGroup[] };
};
export const analysisQueryString = (filters: AnalysisFilters, questionId?: string, compareBy?: AnalysisDimension | '') => {
  const params = new URLSearchParams({ analysis: '1' });
  if (questionId) params.set('questionId', questionId);
  if (compareBy) params.set('compareBy', compareBy);
  const selected = Object.fromEntries(analysisDimensions.filter(key => filters[key]?.length).map(key => [key, [...new Set(filters[key])].sort()]));
  if (Object.keys(selected).length) params.set('filters', JSON.stringify(selected));
  return params.toString();
};
// Multiselect percentages use respondents, not the sum of selected options.
export const answerPercentage = (count: number, respondents: number) => respondents > 0 ? count / respondents * 100 : 0;
export const percentagePointDifference = (count: number, respondents: number, overallCount: number, overallRespondents: number) => answerPercentage(count, respondents) - answerPercentage(overallCount, overallRespondents);
export const analysisColors = ['#0070BA', '#00A67E', '#7B9DB5', '#9467BD', '#B76E24', '#A34F64', '#537B48', '#526777'];
