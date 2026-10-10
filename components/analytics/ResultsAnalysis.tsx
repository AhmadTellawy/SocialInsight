import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Share2, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import type { Survey } from '../../types';
import { api } from '../../services/api';
import { pageRequest } from '../../services/pagesApi';
import { demographicCountries } from '../../utils/demographicSettings';
import { analysisColors, analysisDimensions, analysisQueryString, answerPercentage, percentagePointDifference, type AnalysisDimension, type AnalysisFilters, type AnalysisGroup, type AnalysisResults, type QuestionSummary } from '../../utils/analysis';
import { BottomSheet } from '../BottomSheet';
import { PageError } from '../pages/PageUi';
import { AnalysisFilters as AnalysisFilterSheet } from './AnalysisFilters';
import { AnalysisShare } from './AnalysisShare';
import './analytics.css';

export type AnalysisQuestion = { id: string; text: string; type: string; options?: Array<{ id: string; text: string }>; maxSelection?: number };
export const formatAnalysisNumber = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
export const analysisPercent = (count: number, total: number) => `${formatAnalysisNumber(answerPercentage(count, total))}%`;
export function analysisOptions(summary: QuestionSummary, question?: AnalysisQuestion) {
  const known = question?.options || [];
  return [...new Set([...known.map(option => option.id), ...Object.keys(summary.optionCounts)])].map((id, index) => ({ id, label: known.find(option => option.id === id)?.text || id, count: summary.optionCounts[id] || 0, color: analysisColors[index % analysisColors.length] }));
}
export function AnswerRows({ summary, question }: { summary: QuestionSummary; question?: AnalysisQuestion }) {
  const { i18n } = useTranslation();
  const countLabel = i18n.language.startsWith('ar') ? 'إجابة' : 'responses';
  return <div className="an-answer-list">{analysisOptions(summary, question).map(option => <div className="an-answer" key={option.id}>
    <div className="an-answer-label"><i className="an-dot" style={{ background: option.color }} aria-hidden="true" /><span>{option.label}</span><span className="an-count"><bdi>{formatAnalysisNumber(option.count)}</bdi> {countLabel}</span><strong><bdi>{analysisPercent(option.count, summary.responseCount)}</bdi></strong></div>
    <div className="an-tick-track" aria-hidden="true"><div style={{ width: `${answerPercentage(option.count, summary.responseCount)}%`, background: option.color }} /></div>
  </div>)}</div>;
}
function ComparisonBars({ summary, question, multiple }: { summary: QuestionSummary; question?: AnalysisQuestion; multiple: boolean }) {
  const rows = analysisOptions(summary, question);
  return multiple ? <div className="an-multiple-bars">{rows.map(option => <div className="an-multiple-row" key={option.id}><span>{option.label}</span><span className="an-mini-track"><span style={{ background: option.color, width: answerPercentage(option.count, summary.responseCount) + '%' }} /></span><strong><bdi>{analysisPercent(option.count, summary.responseCount)}</bdi></strong></div>)}</div>
    : <><div className="an-stacked" aria-hidden="true">{rows.map(option => { const percent = answerPercentage(option.count, summary.responseCount); return <span key={option.id} style={{ background: option.color, width: percent + '%', color: option.color === '#0070BA' ? '#fff' : '#142c3d' }}>{percent >= 14 && <bdi>{formatAnalysisNumber(percent)}%</bdi>}</span>; })}</div>
      <div className="an-bar-values">{rows.map(option => <span key={option.id}><i className="an-dot" style={{ background: option.color }} />{option.label} <strong><bdi>{analysisPercent(option.count, summary.responseCount)}</bdi></strong><span className="an-count"><bdi>{option.count}/{summary.responseCount}</bdi></span></span>)}</div></>;
}

type Props = { survey: Survey; isAccessDenied?: boolean; privatePageId?: string; onBack?: () => void };
export function ResultsAnalysis(props: Props) {
  const source = props.survey.sharedFrom || props.survey;
  // A new source gets a fresh filter/question/request state, including during in-app navigation.
  return <AnalysisContent key={`${source.id}:${props.privatePageId || ''}`} {...props} survey={source} />;
}
const AnalysisContent: React.FC<Props> = ({ survey: source, isAccessDenied, privatePageId, onBack }) => {
  const { i18n, t } = useTranslation(), ar = i18n.language.startsWith('ar'), locale = ar ? 'ar' : 'en', id = useId();
  const copy = (arabic: string, english: string) => ar ? arabic : english;
  const num = formatAnalysisNumber;
  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [loaded, setLoaded] = useState<{ filters: AnalysisFilters; compareBy: AnalysisDimension | ''; questionId: string } | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const requestController = useRef<AbortController | null>(null);
  useEffect(() => () => requestController.current?.abort(), []);
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null), [attempt, setAttempt] = useState(0);
  const [questionId, setQuestionId] = useState(''), [compareBy, setCompareBy] = useState<AnalysisDimension | ''>('');
  const [filters, setFilters] = useState<AnalysisFilters>({}), [draft, setDraft] = useState<AnalysisFilters>({});
  const [sheet, setSheet] = useState<'filters' | 'share' | 'cohort' | null>(null), [cohort, setCohort] = useState<AnalysisGroup | null>(null);
  const definitions = source.sections?.flatMap(section => section.questions) || [];
  const query = analysisQueryString(filters, questionId || definitions[0]?.id || undefined, compareBy);
  const restoreComparisonFocus = useRef(false);
  useEffect(() => {
    if (status !== 'ready' || !restoreComparisonFocus.current) return;
    restoreComparisonFocus.current = false;
    if (document.activeElement === document.body) document.getElementById(`${id}-compare`)?.focus({ preventScroll: true });
  }, [status, id]);
  useEffect(() => {
    let current = true;
    setError(null); setStatus('loading'); setCohort(null);
    if (isAccessDenied) { setResults(null); setLoaded(null); setSheet(null); setStatus('denied'); return; }
    const load = async () => {
      // Coalesce rapid changes; aborting fetch alone does not cancel work already in PostgreSQL.
      await inFlight.current;
      if (!current) return;
      const controller = new AbortController();
      requestController.current = controller;
      setStatus('loading');
      const request = (async () => {
        try {
          const data = privatePageId && source.pageId === privatePageId
            ? await pageRequest<AnalysisResults>('/manage/' + encodeURIComponent(privatePageId) + '/content/' + encodeURIComponent(source.id) + '/results?' + query, 'GET', undefined, controller.signal)
            : await api.getPostResults(source.id, controller.signal, query) as AnalysisResults;
          if (data?.version !== 3) throw new Error('Unsupported analysis contract');
          if (current && !controller.signal.aborted) {
            setResults(data); setLoaded({ filters, compareBy, questionId: questionId || definitions[0]?.id || '' }); setStatus('ready'); setError(null);
          }
        } catch (failure: any) {
          if (!current || controller.signal.aborted) return;
          const denied = [401, 403, 404].includes(failure?.status);
          if (denied) { setResults(null); setLoaded(null); setSheet(null); }
          setError(failure); setStatus(denied ? 'denied' : 'error');
        }
      })();
      inFlight.current = request;
      await request;
      if (inFlight.current === request) inFlight.current = null;
    };
    const debounce = window.setTimeout(() => void load(), results ? 180 : 0);
    const timer = privatePageId ? window.setInterval(() => void load(), 30_000) : undefined;
    return () => { current = false; window.clearTimeout(debounce); if (timer !== undefined) window.clearInterval(timer); };
  }, [source.id, source.pageId, privatePageId, isAccessDenied, query, attempt]);
  const questions: AnalysisQuestion[] = definitions.length ? definitions : [{ id: results?.questionSummaries[0]?.questionId || '', text: source.question || source.title, options: source.options, type: 'multiple_choice' }];
  const active = questions.find(question => question.id === (loaded ? loaded.questionId : questionId)) || questions[0];
  const summary = results?.questionSummaries.find(value => value.questionId === active?.id) || (!loaded?.questionId ? results?.questionSummaries[0] : undefined);
  const multiple = Number(active?.maxSelection) > 1 || !!(summary && (Object.values(summary.optionCounts) as number[]).reduce((a, b) => a + b, 0) > summary.responseCount);
  const countries = useMemo(() => Object.fromEntries(demographicCountries(locale).map(country => [country.value, country.label])), [locale]);
  const dimensions: Record<AnalysisDimension, string> = ar
    ? { country: 'البلد', gender: 'الجنس', age: 'الفئة العمرية', marital: 'الحالة الاجتماعية', education: 'المستوى التعليمي', employment: 'الحالة الوظيفية', industry: 'نوع العمل', sector: 'قطاع العمل', nationality: 'الجنسية' }
    : { country: 'Country', gender: 'Gender', age: 'Age group', marital: 'Marital status', education: 'Education', employment: 'Employment status', industry: 'Employment type', sector: 'Employment sector', nationality: 'Nationality' };
  const label = (value: string) => value === 'Unknown' ? copy('غير محدد', 'Unknown') : t(`settingsV2.demographics.options.${value}`, { defaultValue: countries[value] || value });
  const filterEntries = analysisDimensions.flatMap(key => (filters[key] || []).map(value => ({ key, value })));
  const shownEntries = analysisDimensions.flatMap(key => (loaded?.filters[key] || []).map(value => ({ key, value })));
  const displayCompareBy = loaded?.compareBy || '';
  const scope = shownEntries.length ? shownEntries.map(({ key, value }) => `${dimensions[key]}: ${label(value)}`).join(' · ') : copy('جميع المشاركين', 'All respondents');
  const hidden = copy('لا تتوفر هذه التفاصيل لأن تقسيم المشاركين يتضمن مجموعات صغيرة يجب حمايتها. يمكنك عرض النتائج الإجمالية.', 'This breakdown contains small groups whose details are protected. You can view the overall results.');
  const shareAvailable = status === 'ready' && !!summary?.responseCount && !results?.suppressionReason;
  const bars = (value: QuestionSummary) => active?.type === 'text' ? null : <ComparisonBars summary={value} question={active} multiple={multiple} />;
  if (privatePageId && error && status === 'denied') return <PageError error={error} retry={() => setAttempt(value => value + 1)} />;
  return <section className="an-root" dir={ar ? 'rtl' : 'ltr'} aria-label={copy('التحليلات', 'Analytics')}>
    <header className="an-header">{onBack ? <button className="an-icon" onClick={onBack} aria-label={copy('عرض المنشور', 'View post')}>{ar ? <ArrowRight /> : <ArrowLeft />}</button> : <span className="an-icon" />}<h2>{copy('التحليلات', 'Analytics')}</h2><button className="an-icon" onClick={() => setSheet('share')} disabled={!shareAvailable} aria-label={copy('مشاركة التحليل', 'Share analysis')}><Share2 /></button></header>
    <div className="an-content">
      {questions.length > 1 && <nav className="an-questions" aria-label={copy('اختيار السؤال', 'Select question')}><span>{copy('السؤال', 'Question')} <bdi>{Math.max(0, questions.findIndex(question => question.id === active?.id)) + 1}</bdi> {copy('من', 'of')} <bdi>{questions.length}</bdi></span><div>{questions.map((question, index) => <button key={question.id || index} onClick={() => { setQuestionId(question.id); setCohort(null); }} aria-label={`${copy('السؤال', 'Question')} ${index + 1}`} aria-pressed={question.id === active?.id}>{index + 1}</button>)}</div></nav>}
      <h1>{active?.text}</h1>
      <div className="an-toolbar"><button className="an-filter" onClick={() => { setDraft(structuredClone(filters)); setSheet('filters'); }} disabled={status === 'denied'}><SlidersHorizontal size={16} />{copy('تصفية', 'Filter')}{filterEntries.length ? ` · ${filterEntries.length}` : ''}</button><span className="an-sample">{!!results && results.sampleSize !== null && <><b><bdi>{num(summary?.responseCount ?? results?.sampleSize ?? 0)}</bdi></b> {copy('استجابة', 'responses')}</>}</span></div>
      {!!filterEntries.length && <div className="an-chips">{filterEntries.map(({ key, value }) => <button key={`${key}:${value}`} onClick={() => setFilters(current => ({ ...current, [key]: current[key]?.filter(item => item !== value) }))} aria-label={`${copy('إزالة فلتر', 'Remove filter')} ${dimensions[key]} ${label(value)}`}>{label(value)}<X size={12} /></button>)}<button className="an-text-button" onClick={() => setFilters({})}>{copy('مسح الكل', 'Clear all')}</button></div>}
      {status === 'loading' && !results && <p role="status" className="an-empty">{copy('جارٍ تحميل النتائج…', 'Loading results…')}</p>}
      {status === 'loading' && results && <p role="status" className="an-notice">{copy('جارٍ التحديث؛ المعروض آخر نتائج ناجحة.', 'Updating; showing the last successful results.')}</p>}
      {results && status !== 'ready' && <p className="an-hint an-shown-scope">{copy('نطاق النتائج المعروضة: ', 'Displayed results: ')}{scope}</p>}
      {status === 'denied' && <div className="an-empty" role="status"><ShieldCheck /><p>{copy('النتائج غير متاحة لك وفق الصلاحيات وموعد إظهارها.', 'Results are unavailable under the access and timing settings.')}</p></div>}
      {status === 'error' && <div className={results ? 'an-notice an-notice-error' : 'an-empty'} role="alert"><p>{results ? copy('تعذر تحديث النتائج. المعروض آخر نتائج ناجحة.', 'Could not update. Showing the last successful results.') : copy('تعذر تحميل النتائج.', 'Could not load results.')}</p><button className="an-primary" onClick={() => setAttempt(value => value + 1)}>{copy('إعادة المحاولة', 'Retry')}</button></div>}
      {results && (results.suppressionReason ? <div className="an-empty" role="status"><ShieldCheck /><p>{hidden}</p><button className="an-primary" onClick={() => { setFilters({}); setCompareBy(''); }}>{copy('عرض الإجمالي', 'View overall')}</button></div> : !summary?.responseCount ? <p className="an-empty" role="status">{copy('لا توجد استجابات لهذا السؤال ضمن الفلاتر الحالية.', 'No responses to this question match the current filters.')}</p> : <section className="an-results" aria-label={copy('تحليل الإجابات', 'Answer analysis')}>
        <div className="an-section-title"><h3>{copy('الإجابات', 'Answers')}</h3><span>{active?.type === 'text' ? copy('إجابات نصية', 'Text responses') : multiple ? copy('اختيارات متعددة', 'Multiple selections') : copy('اختيار واحد', 'Single selection')}</span></div>
        <label className="an-field" htmlFor={`${id}-compare`}>{copy('مقارنة حسب', 'Compare by')}<select id={`${id}-compare`} value={compareBy} onChange={event => { restoreComparisonFocus.current = true; setCompareBy(event.target.value as AnalysisDimension | ''); }} aria-controls={`${id}-chart`}><option value="">{copy('اختر بُعدًا ديموغرافيًا', 'Choose a demographic dimension')}</option>{analysisDimensions.map(key => <option key={key} value={key}>{dimensions[key]}</option>)}</select></label>
        <div id={`${id}-chart`} aria-live="polite">{!displayCompareBy ? <><AnswerRows summary={summary} question={active} />{multiple && <p className="an-hint">{copy('النسب من المجيبين؛ قد يتجاوز مجموعها 100%.', 'Percentages use respondents; their sum may exceed 100%.')}</p>}</> : <>
          <p className="an-hint">{active?.type === 'text' ? copy('يظهر عدد مجيبي السؤال في كل فئة. النصوص محجوبة لحماية الخصوصية.', 'Shows the number of respondents in each group. Text is withheld for privacy.') : multiple ? copy('النسبة من مجيبي كل فئة؛ قد يتجاوز المجموع 100%.', 'Percentages use respondents in each group; totals may exceed 100%.') : copy('كل شريط يمثل 100% من مجيبي الفئة نفسها.', 'Each bar represents all respondents within that group.')}</p>
          <div className="an-reference"><div className="an-group-title"><strong>{copy('الإجمالي · مرجع المقارنة', 'Overall · comparison reference')}</strong><span><bdi>{num(summary.responseCount)}</bdi> {copy('مجيبًا', 'respondents')}</span></div><p className="an-hint">{scope}</p>{bars(summary)}</div>
          {results?.comparison?.suppressionReason ? <div className="an-notice" role="status"><p>{hidden}</p><button className="an-text-button" onClick={() => { setFilters({}); setCompareBy(''); }}>{copy('عرض النتائج الإجمالية', 'View overall results')}</button></div> : <>{results?.comparison?.groups.map(group => <button className="an-group" disabled={status !== 'ready'} key={group.label} onClick={() => { setCohort(group); setSheet('cohort'); }} aria-label={`${label(group.label)}; ${analysisOptions(group, active).map(option => `${option.label}: ${analysisPercent(option.count, group.responseCount)}, ${option.count}/${group.responseCount}`).join('; ')}`}><span className="an-group-title"><strong>{label(group.label)}</strong><span><bdi>{num(group.responseCount)}</bdi> {copy('مجيبًا', 'respondents')}</span></span>{bars(group)}</button>)}<p className="an-hint">{copy('اضغط على فئة لعرض الأعداد والفارق عن الإجمالي.', 'Select a group for counts and percentage-point differences.')}</p></>}
        </>}{!!summary.textResponseCount && <p className="an-hint"><bdi>{num(summary.textResponseCount)}</bdi> {copy('إجابة نصية؛ النصوص محجوبة لحماية الخصوصية.', 'text responses; their text is withheld for privacy.')}</p>}</div>
      </section>)}
      {status === 'ready' && results?.scoreDistribution && <section className="an-results"><h3>{copy('توزيع الدرجات', 'Score distribution')}</h3>{results.scoreDistribution.suppressionReason ? <p className="an-hint">{hidden}</p> : <AnswerRows summary={{ questionId: 'scores', responseCount: (Object.values(results.scoreDistribution.counts) as number[]).reduce((a, b) => a + b, 0), optionCounts: results.scoreDistribution.counts, textResponseCount: 0 }} question={{ id: 'scores', text: '', type: 'score', options: Object.keys(results.scoreDistribution.counts).map(key => ({ id: key, text: key })) }} />}</section>}
      {results && <footer className="an-footer"><span>{copy('النسب من مجيبي السؤال', 'Percentages of question respondents')}</span><b dir="ltr">Opini<span>Up</span></b></footer>}
    </div>
    <AnalysisFilterSheet open={sheet === 'filters'} onClose={() => setSheet(null)} onApply={value => { setFilters(value); setSheet(null); }} draft={draft} setDraft={setDraft} dimensions={dimensions} label={label} available={results?.filterOptions || {}} protectedDetails={!!results?.demographicSuppressionReason} ar={ar} />
    <BottomSheet isOpen={sheet === 'cohort'} onClose={() => setSheet(null)} title={cohort ? label(cohort.label) : ''} showCloseButton closeLabel={copy('إغلاق', 'Close')}>
      <div className="an-root an-sheet-content" dir={ar ? 'rtl' : 'ltr'}>
        {sheet === 'cohort' && cohort && summary && <><p className="an-hint">{active?.text}</p><p className="an-cohort-context">{label(cohort.label)} · <bdi>{num(cohort.responseCount)}</bdi> {copy('مجيبًا', 'respondents')}<br />{copy('الإجمالي المرجعي', 'Overall reference')}: <bdi>{num(summary.responseCount)}</bdi> · {scope}</p>{analysisOptions(cohort, active).map(option => { const overall = summary.optionCounts[option.id] || 0, delta = percentagePointDifference(option.count, cohort.responseCount, overall, summary.responseCount); return <div className="an-cohort-detail" key={option.id}><h3><i className="an-dot" style={{ background: option.color }} />{option.label}</h3><div className="an-cohort-numbers"><strong><bdi>{analysisPercent(option.count, cohort.responseCount)}</bdi></strong><span><bdi>{num(option.count)}</bdi> {copy('من', 'of')} <bdi>{num(cohort.responseCount)}</bdi></span></div><p>{Math.abs(delta) < .05 ? copy('مماثلة للإجمالي', 'Same as overall') : <>{delta > 0 ? copy('أعلى من الإجمالي بـ ', 'Above overall by ') : copy('أقل من الإجمالي بـ ', 'Below overall by ')}<bdi>{num(Math.abs(delta))}</bdi> {copy('نقطة مئوية', 'percentage points')}</>}</p><p className="an-hint">{copy('نسبة الإجمالي', 'Overall percentage')}: <bdi>{analysisPercent(overall, summary.responseCount)}</bdi></p></div>; })}</>}
      </div>
    </BottomSheet>
    {results && <AnalysisShare open={sheet === 'share'} onClose={() => setSheet(null)} results={results} questions={questions} activeQuestionId={summary?.questionId || ''} scope={scope} sourceTitle={source.title} ar={ar} />}
  </section>;
}
