import { calculateAgeGroupFromDate } from '../utils/profileValidation';

export const MIN_AGGREGATE_CELL = 5;
export type ProtectedDistribution = { counts: Record<string, number>; suppressionReason: 'SMALL_SAMPLE' | 'SMALL_CELLS' | null };
// Suppress the whole marginal when any nonempty cell is small. Suppressing only
// that cell lets its value be recovered by subtracting released cells from totals.
export const protectDistribution = (counts: Record<string, number>, sampleSize: number): ProtectedDistribution => {
  if (sampleSize < MIN_AGGREGATE_CELL) return { counts: {}, suppressionReason: 'SMALL_SAMPLE' };
  if (Object.values(counts).some(count => count > 0 && count < MIN_AGGREGATE_CELL)) return { counts: {}, suppressionReason: 'SMALL_CELLS' };
  return { counts, suppressionReason: null };
};

export class AggregateResults {
  sampleSize = 0;
  private demographics: Record<string, Record<string, number>> = Object.fromEntries(['age', 'gender', 'country', 'education', 'employment', 'industry', 'sector'].map(key => [key, {}]));
  private questions = new Map<string, { responseCount: number; optionCounts: Record<string, number>; textResponseCount: number }>();
  private scores: Record<string, number> = { '91–100%': 0, '81–90%': 0, '71–80%': 0, '61–70%': 0, '51–60%': 0, '0–50%': 0 };
  constructor(private correctOptions: Map<string, Set<string>> = new Map()) {}
  add(response: { answers: Array<{ questionId: string; optionId?: string | null; textValue?: string | null }>; user?: any }): void {
    this.sampleSize++;
    const user = response.user;
    const dimensions: Record<string, string> = {
      age: calculateAgeGroupFromDate(user?.birthday) || 'Unknown', gender: user?.demographics?.gender || 'Unknown', country: user?.country || 'Unknown',
      education: user?.demographics?.educationLevel || 'Unknown', employment: user?.demographics?.employmentType || 'Unknown', industry: user?.demographics?.industry || 'Unknown', sector: user?.demographics?.employmentSector || 'Unknown'
    };
    for (const [key, value] of Object.entries(dimensions)) this.demographics[key][value] = (this.demographics[key][value] || 0) + 1;
    const answered = new Map<string, Set<string>>();
    const textQuestions = new Set<string>();
    for (const answer of response.answers) {
      if (!answered.has(answer.questionId)) answered.set(answer.questionId, new Set());
      if (answer.optionId) answered.get(answer.questionId)!.add(answer.optionId);
      if (answer.textValue) textQuestions.add(answer.questionId);
    }
    for (const [questionId, options] of answered) {
      const summary = this.questions.get(questionId) || { responseCount: 0, optionCounts: {}, textResponseCount: 0 };
      summary.responseCount++;
      options.forEach(id => { summary.optionCounts[id] = (summary.optionCounts[id] || 0) + 1; });
      if (textQuestions.has(questionId)) summary.textResponseCount++;
      this.questions.set(questionId, summary);
    }
    if (this.correctOptions.size) {
      let correct = 0;
      this.correctOptions.forEach((expected, questionId) => {
        const actual = answered.get(questionId) || new Set();
        if (actual.size === expected.size && [...actual].every(id => expected.has(id))) correct++;
      });
      const score = Math.round(correct / this.correctOptions.size * 100);
      const bucket = score >= 91 ? '91–100%' : score >= 81 ? '81–90%' : score >= 71 ? '71–80%' : score >= 61 ? '61–70%' : score >= 51 ? '51–60%' : '0–50%';
      this.scores[bucket]++;
    }
  }
  toJSON() {
    return {
      version: 2, sampleSize: this.sampleSize, minimumCellSize: MIN_AGGREGATE_CELL,
      questionSummaries: [...this.questions].map(([questionId, value]) => ({ questionId, responseCount: value.responseCount,
        optionCounts: value.optionCounts, textResponseCount: value.textResponseCount })),
      demographicBreakdowns: Object.fromEntries(Object.entries(this.demographics).map(([key, counts]) => [key, protectDistribution(counts, this.sampleSize)])),
      scoreDistribution: this.correctOptions.size ? protectDistribution(this.scores, this.sampleSize) : null
    };
  }
}
