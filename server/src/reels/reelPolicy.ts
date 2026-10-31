export const REEL_MAX_BYTES = 150 * 1024 * 1024;
export const REEL_MAX_SECONDS = 60;
export const REEL_MAX_QUESTIONS = 10;

export class ReelError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export function validateReelInput(data: any): void {
  if (data.presentationFormat !== 'REEL') return;
  if (!['poll', 'survey', 'quiz'].includes(String(data.type).toLowerCase())) throw new ReelError('REEL_TYPE', 'Choose a question, survey or quiz.');
  if (typeof data.videoAssetId !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.videoAssetId)) throw new ReelError('REEL_VIDEO_REQUIRED', 'Choose a video first.');
  // Validate every input representation, including hidden or inactive branches.
  const pending: Array<{ value: any; depth: number }> = [{ value: data, depth: 0 }];
  let inspected = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (!value || typeof value !== 'object') continue;
    if (depth > 24 || ++inspected > 5000) throw new ReelError('REEL_INPUT_LIMIT', 'Reel content is too complex.');
    for (const [key, child] of Object.entries(value)) {
      if (['image', 'coverImage', 'imageMediaId', 'imageMedia', 'media', 'mediaAssetIds', 'mediaDrafts'].includes(key)
        && child && (!Array.isArray(child) || child.length)) throw new ReelError('REEL_TEXT_ONLY', 'Reel questions and answers cannot contain images.');
      if (key === 'optionPresentation' && child === 'image') throw new ReelError('REEL_TEXT_ONLY', 'Use text answers.');
      if (child && typeof child === 'object') pending.push({ value: child, depth: depth + 1 });
    }
  }
  const enabled = (value: unknown) => value === true || value === 1 || (typeof value === 'string' && ['true', '1'].includes(value.toLowerCase()));
  if (enabled(data.allowUserOptions)) throw new ReelError('REEL_SETTINGS', 'Participant-added options are unavailable for Reels.');
  if (Array.isArray(data.demographics) ? data.demographics.length : data.demographics && data.demographics !== '[]') throw new ReelError('REEL_SETTINGS', 'Additional demographic questions are unavailable for Reels.');
  if (['Custom Audience', 'Custom Domain'].includes(data.targetAudience)) throw new ReelError('REEL_SETTINGS', 'Choose your profile, followers or groups.');
  if (String(data.type).toLowerCase() === 'quiz' && enabled(data.allowMultipleSelection)) throw new ReelError('REEL_SETTINGS', 'Quiz questions accept one answer.');
  if (data.sections != null && (!Array.isArray(data.sections) || data.sections.some((section: any) => !section || !Array.isArray(section.questions)))) throw new ReelError('REEL_STRUCTURE', 'Invalid question sections.');
  const questions = data.sections?.flatMap((section: any) => section.questions) || [];
  if (questions.length > REEL_MAX_QUESTIONS) throw new ReelError('REEL_QUESTIONS_LIMIT', 'Use up to 10 questions.');
  if (data.status === 'DRAFT') return;
  const all = String(data.type).toLowerCase() === 'poll' ? [{ text: data.title, options: data.options }] : questions;
  if (!all.length) throw new ReelError('REEL_QUESTION_REQUIRED', 'Add at least one question.');
  for (const q of all) {
    if (!q || typeof q.text !== 'string' || !q.text.trim() || q.text.length > 10000) throw new ReelError('REEL_QUESTION_REQUIRED', 'Write each question.');
    if (q.type !== 'text' && (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6 || q.options.some((o: any) => !o || typeof o.text !== 'string' || !o.text.trim() || o.text.length > 10000))) throw new ReelError('REEL_ANSWERS', 'Add between 2 and 6 text answers.');
    if (String(data.type).toLowerCase() === 'quiz' && !q.options?.some((o: any) => o.id === q.correctOptionId)) throw new ReelError('REEL_CORRECT_ANSWER', 'Select one correct answer for every question.');
  }
}

/** One atomic submission, with exact membership validation before any counters change. */
export function validateReelSubmission(questions: any[], answers: any[], optionIds: string[], multiple: boolean, quiz: boolean): void {
  const supplied = answers.length ? answers : optionIds.map(id => ({ optionId: id, questionId: questions.find(q => q.options.some((o: any) => o.id === id))?.id }));
  for (const q of questions) {
    const selected = supplied.filter(a => a.questionId === q.id);
    if ((q.isRequired || quiz) && !selected.length) throw new ReelError('REEL_INCOMPLETE', 'Answer all required questions before submitting.');
    if ((!multiple || quiz || q.type === 'text') && selected.length > 1) throw new ReelError('REEL_ANSWER_LIMIT', 'Choose one answer for this question.');
    for (const a of selected) {
      if (q.type === 'text' ? typeof a.textValue !== 'string' || !a.textValue.trim() || a.textValue.length > 10000 || a.optionId : !q.options.some((o: any) => o.id === a.optionId)) throw new ReelError('REEL_INVALID_ANSWER', 'An answer does not belong to this question.');
    }
  }
  if (!supplied.length || supplied.some(a => !questions.some(q => q.id === a.questionId))) throw new ReelError('REEL_INVALID_ANSWER', 'Invalid answers.');
}
