import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Survey, SurveyType, UserProfile, PostAnswerPayload } from '../../types';
import { api } from '../../services/api';
import { reelsApi } from '../../services/reelsApi';
import { BottomSheet } from '../BottomSheet';
import { SurveyQuestion } from '../Survey/SurveyQuestion';

// Volatile drafts survive navigating between Reels, never a storage write.
type AnswerDraft = { index: number; answers: Record<string, string[]>; followUps: Record<string, string>; texts: Record<string, string>; anonymous: boolean; at: number };
const drafts = new Map<string, AnswerDraft>();

export function ReelQuestionsSheet({ survey, user, open, onClose, onComplete }: { survey: Survey; user?: UserProfile; open: boolean; onClose: () => void; onComplete?: () => void }) {
  const { i18n } = useTranslation(); const ar = i18n.language.startsWith('ar');
  const questions = survey.sections?.flatMap(section => section.questions) || [];
  const all = questions.length ? questions : [{ id: survey.id, text: survey.title, type: 'multiple_choice', isRequired: true, options: survey.options || [] }];
  const draftKey = `${user?.id || 'guest'}:${survey.id}`;
  const saved = drafts.get(draftKey);
  const initial = saved && Date.now() - saved.at < 30 * 60_000 ? saved : undefined;
  const [index, setIndex] = useState(initial?.index || 0);
  const [answers, setAnswers] = useState<Record<string, string[]>>(initial?.answers || {});
  const [followUps, setFollowUps] = useState<Record<string, string>>(initial?.followUps || {});
  const [texts, setTexts] = useState<Record<string, string>>(initial?.texts || {});
  const [anonymous, setAnonymous] = useState(initial?.anonymous || !!survey.forceAnonymous);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [done, setDone] = useState(!!survey.hasParticipated);
  const [score, setScore] = useState<{ correct: number; total: number }>();
  const q = all[Math.min(index, all.length - 1)];
  const expired = Boolean(survey.expiresAt && new Date(survey.expiresAt).getTime() <= Date.now());
  const multiple = survey.type !== SurveyType.QUIZ && !!survey.allowMultipleSelection;
  useEffect(() => { if (survey.hasParticipated) setDone(true); }, [survey.hasParticipated]);
  useEffect(() => {
    if (done) { drafts.delete(draftKey); return; }
    drafts.set(draftKey, { index, answers, followUps, texts, anonymous, at: Date.now() });
    if (drafts.size > 20) drafts.delete(drafts.keys().next().value!);
  }, [draftKey, index, answers, followUps, texts, anonymous, done]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void reelsApi.result(survey.id, controller.signal).then(result => { if (!controller.signal.aborted) { setDone(result.completed); setScore(result.quizResult); } }).catch(() => {});
    return () => controller.abort();
  }, [open, survey.id, user?.id]);
  const answered = (question: typeof q) => question.type === 'text' ? !!texts[question.id]?.trim() : !!answers[question.id]?.length;
  const submit = async () => {
    if (busy || done) return;
    const missing = all.findIndex(question => question.isRequired !== false && !answered(question));
    if (missing >= 0) { setIndex(missing); setError(ar ? 'أكمل الأسئلة المطلوبة أولًا.' : 'Answer all required questions first.'); return; }
    setBusy(true); setError('');
    try {
      const payload: PostAnswerPayload[] = questions.length ? all.flatMap(question => question.type === 'text' ? (texts[question.id]?.trim() ? [{ questionId: question.id, textValue: texts[question.id].trim() }] : []) : (answers[question.id] || []).map(optionId => ({ questionId: question.id, optionId, textValue: followUps[optionId] || undefined }))) : [];
      const result = await api.vote(survey.id, questions.length ? [] : answers[q.id] || [], user?.id, anonymous || !!survey.forceAnonymous, undefined, followUps, payload);
      setScore(result.quizResult); setDone(true); onComplete?.();
    } catch (e) { setError(e instanceof Error ? e.message : (ar ? 'تعذر إرسال الإجابات. حاول مجددًا.' : 'Unable to submit. Try again.')); }
    finally { setBusy(false); }
  };
  return <BottomSheet isOpen={open} onClose={onClose} title={survey.type === SurveyType.QUIZ ? (ar ? 'الاختبار' : 'Quiz') : (ar ? 'الأسئلة' : 'Questions')} height="78dvh" historyKey={`reel-questions:${survey.id}`} dismissDisabled={busy} showCloseButton>
    <div className="space-y-5 text-gray-900" dir={ar ? 'rtl' : 'ltr'}>
      {done ? <div role="status" className="py-10 text-center space-y-4"><CheckCircle2 className="mx-auto text-blue-600" size={44} /><h2 className="font-bold">{ar ? 'تم تسجيل إجاباتك' : 'Your answers are recorded'}</h2>{score && <p className="text-3xl font-bold text-blue-600">{score.correct} / {score.total}</p>}<button className="rounded-xl bg-blue-600 text-white px-6 py-3" onClick={onClose}>{ar ? 'العودة للريل' : 'Back to Reel'}</button></div> : <>
        <div className="flex items-center justify-between text-xs text-gray-500"><span>{ar ? `السؤال ${index + 1} من ${all.length}` : `Question ${index + 1} of ${all.length}`}</span>{q.isRequired !== false && <span>{ar ? 'مطلوب' : 'Required'}</span>}</div>
        <div className="flex gap-1" aria-hidden="true">{all.map((question, i) => <span key={question.id} className={`h-1 flex-1 rounded-full ${i === index || answered(question) ? 'bg-blue-600' : 'bg-gray-100'}`} />)}</div>
        <h2 className="text-base font-bold" dir="auto">{q.text}</h2>
        {expired && <p role="status" className="rounded-xl bg-gray-50 p-3 text-sm">{ar ? 'انتهت مدة الإجابة. يمكنك الاستمرار بمشاهدة الريل.' : 'Responses have closed. You can still watch this Reel.'}</p>}
        {q.type === 'text' ? <textarea className="w-full rounded-xl border border-gray-200 p-3" aria-label={ar ? 'إجابتك' : 'Your answer'} value={texts[q.id] || ''} maxLength={10000} disabled={busy || expired} onChange={e => setTexts(x => ({ ...x, [q.id]: e.target.value }))} /> : <SurveyQuestion sourceSurvey={{ ...survey, sections: [] }} options={q.options || []} selectedOptions={answers[q.id] || []} shouldShowResults={false} hasVoted={busy} isExpired={expired} hasImages={false} isHorizontal={false} isRating={!!q.options?.some(o => o.isRating)} isMultiple={multiple} totalVotes={0} portraitImages={new Set()} followUpAnswers={followUps} onFollowUpChange={(id, value) => setFollowUps(x => ({ ...x, [id]: value }))} onOptionClick={id => { if (!busy && !expired) setAnswers(x => ({ ...x, [q.id]: multiple ? (x[q.id]?.includes(id) ? x[q.id].filter(value => value !== id) : [...x[q.id] || [], id]) : [id] })); }} onRatingSelect={option => setAnswers(x => ({ ...x, [q.id]: [option.id] }))} onImageExpand={() => {}} onDetectOrientation={() => {}} />}
        {survey.allowAnonymous && !survey.forceAnonymous && <label className="flex gap-3 items-center text-sm"><input type="checkbox" checked={anonymous} disabled={busy} onChange={e => setAnonymous(e.target.checked)} className="accent-blue-600" />{ar ? 'المشاركة بشكل مجهول' : 'Respond anonymously'}</label>}
        {survey.forceAnonymous && <p className="text-xs text-gray-500">{ar ? 'إجاباتك مجهولة الهوية' : 'Your answers are anonymous'}</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3"><button disabled={index === 0 || busy} className="rounded-xl border px-4 py-3 disabled:opacity-40" aria-label={ar ? 'السابق' : 'Previous'} onClick={() => setIndex(x => x - 1)}>{ar ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button><button disabled={busy || expired} className="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-40" onClick={() => { if (index < all.length - 1) { setIndex(x => x + 1); setError(''); } else void submit(); }}>{busy ? (ar ? 'جارٍ الإرسال…' : 'Submitting…') : index < all.length - 1 ? (ar ? 'التالي' : 'Next') : (ar ? 'إرسال الإجابات' : 'Submit answers')}</button></div>
      </>}
    </div>
  </BottomSheet>;
}
