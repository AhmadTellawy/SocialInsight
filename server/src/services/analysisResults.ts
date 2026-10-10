import { calculateAgeGroupFromDate } from '../utils/profileValidation';
import { MIN_AGGREGATE_CELL } from './aggregateResults';

export const ANALYSIS_DIMENSIONS = ['country', 'gender', 'age', 'marital', 'education', 'employment', 'industry', 'sector', 'nationality'] as const;
type Dimension = typeof ANALYSIS_DIMENSIONS[number];
export type AnalysisQuery = { questionId?: string; compareBy?: Dimension; filters: Partial<Record<Dimension, string[]>> };
type Answer = { questionId: string; optionId?: string | null; textValue?: string | null };
type ResponseRow = { answers: Answer[]; user?: { birthday?: Date | null; country?: string | null; demographics?: Record<string, string | null> | null } | null };
type Summary = { questionId: string; responseCount: number; optionCounts: Record<string, number>; textResponseCount: number };
type Cell = { dimensions: Record<Dimension, string>; answers: Record<string, { options: string[]; hasText: boolean }>; count: number };

export class InvalidAnalysisQuery extends Error {}
export function parseAnalysisQuery(query: Record<string, unknown> = {}): AnalysisQuery | undefined {
  if (query.analysis === undefined) return undefined;
  if (query.analysis !== '1') throw new InvalidAnalysisQuery('Invalid analysis request');
  const { questionId, compareBy } = query;
  if (questionId !== undefined && (typeof questionId !== 'string' || questionId.length > 100)) throw new InvalidAnalysisQuery('Invalid question');
  if (compareBy !== undefined && (typeof compareBy !== 'string' || !ANALYSIS_DIMENSIONS.includes(compareBy as Dimension))) throw new InvalidAnalysisQuery('Invalid comparison');
  let filters: unknown = {};
  try {
    if (query.filters !== undefined) {
      if (typeof query.filters !== 'string' || query.filters.length > 4096) throw new Error();
      filters = JSON.parse(query.filters);
    }
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error();
    for (const [key, values] of Object.entries(filters)) {
      if (!ANALYSIS_DIMENSIONS.includes(key as Dimension) || !Array.isArray(values) || values.length > 30 || values.some(v => typeof v !== 'string' || !v.length || v.length > 150)) throw new Error();
    }
  } catch { throw new InvalidAnalysisQuery('Invalid filters'); }
  return { questionId: questionId as string | undefined, compareBy: compareBy as Dimension | undefined, filters: filters as AnalysisQuery['filters'] };
}

/** Server-only cells. No response IDs, text, birthdays, or per-person vectors leave this class.
 * Every released demographic query is a union of the same complete cells. Requiring
 * at least k identical demographic AND answer profiles prevents reconstructing a small
 * group by combining filters, complements, dimensions, or questions in this snapshot.
 * This is a conservative snapshot guard, not a differential-privacy/time-series guarantee.
 */
export class AnalysisResults {
  private cells = new Map<string, Cell>();
  private capacityExceeded = false;
  add(response: ResponseRow): void {
    if (this.capacityExceeded) return;
    const user = response.user, demo = user?.demographics;
    const dimensions: Record<Dimension, string> = {
      country: user?.country || 'Unknown', gender: demo?.gender || 'Unknown',
      age: calculateAgeGroupFromDate(user?.birthday) || 'Unknown', marital: demo?.maritalStatus || 'Unknown',
      education: demo?.educationLevel || 'Unknown', employment: demo?.employmentType || 'Unknown',
      industry: demo?.industry || 'Unknown', sector: demo?.employmentSector || 'Unknown', nationality: demo?.nationality || 'Unknown'
    };
    const grouped = new Map<string, { options: Set<string>; hasText: boolean }>();
    for (const answer of response.answers) {
      const value = grouped.get(answer.questionId) || { options: new Set<string>(), hasText: false };
      if (answer.optionId) value.options.add(answer.optionId);
      if (answer.textValue) value.hasText = true;
      grouped.set(answer.questionId, value);
    }
    const answers = Object.fromEntries([...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => [id, { options: [...value.options].sort(), hasText: value.hasText }]));
    const key = JSON.stringify([dimensions, answers]);
    const existing = this.cells.get(key);
    if (existing) existing.count++;
    else if (this.cells.size >= 20_000) { this.cells.clear(); this.capacityExceeded = true; }
    else this.cells.set(key, { dimensions, answers, count: 1 });
  }
  private summarize(cells: Cell[]): Summary[] {
    const questions = new Map<string, Summary>();
    for (const cell of cells) for (const [questionId, answer] of Object.entries(cell.answers)) {
      const value = questions.get(questionId) || { questionId, responseCount: 0, optionCounts: {}, textResponseCount: 0 };
      value.responseCount += cell.count;
      for (const option of answer.options) value.optionCounts[option] = (value.optionCounts[option] || 0) + cell.count;
      if (answer.hasText) value.textResponseCount += cell.count;
      questions.set(questionId, value);
    }
    return [...questions.values()];
  }
  toJSON(query: AnalysisQuery, overall: { sampleSize: number; questionSummaries: Summary[]; scoreDistribution?: unknown }) {
    const cells = [...this.cells.values()];
    const unsafe = this.capacityExceeded || cells.some(cell => cell.count < MIN_AGGREGATE_CELL);
    const filtered = Object.values(query.filters).some(values => values?.length);
    const selected = cells.filter(cell => Object.entries(query.filters).every(([key, values]) => !values?.length || values.includes(cell.dimensions[key as Dimension])));
    const suppressionReason = unsafe && filtered ? 'SMALL_CELLS' as const : null;
    const comparisonSuppression = unsafe ? 'SMALL_CELLS' as const : null;
    const summaries = suppressionReason ? [] : filtered ? this.summarize(selected) : overall.questionSummaries;
    const questionId = query.questionId || summaries[0]?.questionId;
    const summary = summaries.find(item => item.questionId === questionId);
    const categories = !unsafe ? Object.fromEntries(ANALYSIS_DIMENSIONS.map(key => [key, [...new Set(cells.map(cell => cell.dimensions[key]))].sort()])) : {};
    const groups = new Map<string, Cell[]>();
    if (query.compareBy && !comparisonSuppression && questionId) for (const cell of selected) {
      if (!cell.answers[questionId]) continue;
      const key = cell.dimensions[query.compareBy];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(cell);
    }
    return {
      version: 3 as const, minimumCellSize: MIN_AGGREGATE_CELL,
      sampleSize: suppressionReason ? null : filtered ? selected.reduce((sum, cell) => sum + cell.count, 0) : overall.sampleSize,
      suppressionReason, questionSummaries: summaries, filterOptions: categories,
      scoreDistribution: !filtered ? overall.scoreDistribution || null : null,
      demographicSuppressionReason: unsafe ? 'SMALL_CELLS' as const : null,
      comparison: query.compareBy ? { dimension: query.compareBy, questionId, suppressionReason: comparisonSuppression,
        overall: suppressionReason ? null : summary || null,
        groups: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, rows]) => ({ label, ...this.summarize(rows).find(item => item.questionId === questionId)! }))
      } : null
    };
  }
}
