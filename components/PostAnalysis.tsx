import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ShieldCheck } from 'lucide-react';
import type { Survey } from '../types';
import { api } from '../services/api';
import { demographicCountries } from '../utils/demographicSettings';

type Distribution = { counts: Record<string, number>; suppressionReason: string | null };
type Results = { version: 2; sampleSize: number; minimumCellSize: number; questionSummaries: Array<{ questionId: string; responseCount: number; optionCounts: Record<string, number>; textResponseCount: number }>; demographicBreakdowns: Record<string, Distribution>; scoreDistribution: Distribution | null };

export const AggregateBars: React.FC<{ counts: Record<string, number>; labels?: Record<string, string>; locale: string }> = ({ counts, labels = {}, locale }: { counts: Record<string, number>; labels?: Record<string, string>; locale: string }) => {
  const { t } = useTranslation();
  const countryNames = Object.fromEntries(demographicCountries(locale).map(country => [country.value, country.label]));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return <div className="space-y-4">{Object.entries(counts).map(([key, count]) => <div key={key}>
    <div className="flex justify-between gap-4 text-sm mb-1"><span className="break-words">{labels[key] || t(`settingsV2.demographics.options.${key}`, { defaultValue: countryNames[key] || key })}</span><span className="tabular-nums shrink-0">{count.toLocaleString(locale)} · {total ? Math.round(count / total * 100) : 0}%</span></div>
    <div aria-hidden="true" className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-blue-600" style={{ width: `${total ? count / total * 100 : 0}%` }} /></div>
  </div>)}</div>;
};

export const PostAnalysis: React.FC<{ survey: Survey; isAccessDenied?: boolean }> = ({ survey, isAccessDenied }) => {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  const source = survey.sharedFrom || survey;
  const [results, setResults] = useState<Results | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [dimension, setDimension] = useState('age');
  useEffect(() => {
    setResults(null);
    if (isAccessDenied) { setState('denied'); return; }
    const controller = new AbortController();
    setState('loading');
    api.getPostResults(source.id, controller.signal).then((data: Results) => {
      if (data?.version !== 2) throw new Error('Unsupported aggregate results');
      if (!controller.signal.aborted) { setResults(data); setState('ready'); }
    }).catch((error: any) => { if (!controller.signal.aborted) setState(error?.status === 403 || error?.status === 404 ? 'denied' : 'error'); });
    return () => controller.abort();
  }, [source.id, isAccessDenied, attempt]);
  const choices = ar ? { age: 'الفئة العمرية', gender: 'الجنس', country: 'البلد', education: 'المستوى التعليمي', employment: 'الحالة الوظيفية', industry: 'نوع العمل', sector: 'قطاع العمل' } : { age: 'Age group', gender: 'Gender', country: 'Country', education: 'Education', employment: 'Employment status', industry: 'Employment type', sector: 'Employment sector' };
  const hidden = ar ? 'حُجب هذا التوزيع لحماية المجموعات الصغيرة. لا تتوفر تصفية الإجابات حسب بيانات فردية.' : 'This distribution is withheld to protect small groups. Individual response and demographic filtering is unavailable.';
  const questions = source.sections?.flatMap(section => section.questions) || [];
  const labels = Object.fromEntries([...questions.flatMap(question => question.options || []), ...(source.options || [])].map(option => [option.id, option.text]));
  const exportResults = () => {
    if (!results) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `aggregate-results-${source.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section dir={ar ? 'rtl' : 'ltr'} className="p-4 md:p-6 space-y-6 bg-white text-gray-900 min-h-full">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-bold">{ar ? 'تحليل النتائج' : 'Results analysis'}</h2><p className="text-sm text-gray-600 mt-1">{source.title}</p></div>{results && <button type="button" onClick={exportResults} className="inline-flex gap-2 items-center px-4 py-2 rounded-xl border text-sm"><Download size={16} />{ar ? 'تنزيل النتائج المجمعة' : 'Download aggregates'}</button>}</header>
    {state === 'loading' && <p role="status">{ar ? 'جارٍ تحميل النتائج…' : 'Loading results…'}</p>}
    {state === 'denied' && <p role="status">{ar ? 'لا تتوفر النتائج لك وفق إعدادات الجمهور وموعد إظهار النتائج.' : 'These results are unavailable under the post’s audience and timing settings.'}</p>}
    {state === 'error' && <div role="alert"><p>{ar ? 'تعذر تحميل النتائج.' : 'Results could not be loaded.'}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 border rounded-xl px-4 py-2">{ar ? 'إعادة المحاولة' : 'Retry'}</button></div>}
    {results && <>
      <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4 flex gap-3"><ShieldCheck className="shrink-0 text-blue-700" size={22} /><div><p className="font-semibold">{results.sampleSize.toLocaleString(i18n.language)} {ar ? 'استجابة' : 'responses'}</p><p className="text-sm mt-1">{ar ? 'إحصاءات مجمعة فقط. تُحجب التوزيعات الديموغرافية إذا احتوت فئة أقل من ٥ استجابات. لا تظهر نصوص الإجابات أو هويات أصحابها.' : 'Only aggregates are shown. Demographic distributions containing a group smaller than 5 are withheld. Response text and respondent identities are excluded.'}</p></div></div>
      {!results.sampleSize && <p>{ar ? 'لا توجد استجابات بعد.' : 'There are no responses yet.'}</p>}
      {results.questionSummaries.map((summary, index) => <article key={summary.questionId} className="rounded-2xl border p-4 space-y-4"><h3 className="font-semibold">{questions.find(question => question.id === summary.questionId)?.text || (results.questionSummaries.length === 1 ? source.question || source.title : `${ar ? 'السؤال' : 'Question'} ${index + 1}`)}</h3><p className="text-sm text-gray-600">{summary.responseCount.toLocaleString(i18n.language)} {ar ? 'استجابة · نسب الخيارات من إجمالي الاختيارات' : 'responses · option percentages use total selections'}</p><AggregateBars counts={summary.optionCounts} labels={labels} locale={i18n.language} />{summary.textResponseCount > 0 && <p className="text-sm text-gray-600">{summary.textResponseCount.toLocaleString(i18n.language)} {ar ? 'إجابة نصية؛ النصوص محجوبة لحماية الخصوصية.' : 'text responses; text is withheld for privacy.'}</p>}</article>)}
      {results.scoreDistribution && <article className="rounded-2xl border p-4 space-y-4"><h3 className="font-semibold">{ar ? 'توزيع الدرجات' : 'Score distribution'}</h3>{results.scoreDistribution.suppressionReason ? <p className="text-sm text-gray-600">{hidden}</p> : <AggregateBars counts={results.scoreDistribution.counts} locale={i18n.language} />}</article>}
      <article className="rounded-2xl border p-4 space-y-4"><label className="font-semibold block" htmlFor="aggregate-dimension">{ar ? 'توزيع المشاركين' : 'Participant distribution'}</label><select id="aggregate-dimension" value={dimension} onChange={event => setDimension(event.target.value)} className="border rounded-xl p-3 w-full bg-white">{Object.entries(choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{results.demographicBreakdowns[dimension]?.suppressionReason ? <p className="text-sm text-gray-600">{hidden}</p> : <AggregateBars counts={results.demographicBreakdowns[dimension]?.counts || {}} labels={{ Unknown: ar ? 'غير محدد' : 'Unknown' }} locale={i18n.language} />}</article>
    </>}
  </section>;
};
