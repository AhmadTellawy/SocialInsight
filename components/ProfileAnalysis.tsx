import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { UserProfile } from '../types';
import { api } from '../services/api';
import { AggregateBars } from './PostAnalysis';

export const ProfileAnalysis: React.FC<{ userProfile: UserProfile; onBack: () => void }> = ({ userProfile, onBack }) => {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dimension, setDimension] = useState('byType');
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError(false);
    api.getUserAnalytics(userProfile.id, controller.signal).then(value => { if (!controller.signal.aborted) setData(value); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [userProfile.id, attempt]);
  const choices = ar ? { byType: 'نوع المنشور', byCountry: 'البلد', byGender: 'الجنس', byAge: 'الفئة العمرية' } : { byType: 'Post type', byCountry: 'Country', byGender: 'Gender', byAge: 'Age group' };
  const distribution = dimension === 'byType' ? { counts: data?.byType || {}, suppressionReason: null } : data?.[dimension];
  return <section dir={ar ? 'rtl' : 'ltr'} className="p-4 md:p-6 space-y-6 bg-white text-gray-900 min-h-full">
    <header className="flex gap-3 items-center"><button type="button" onClick={onBack} aria-label={ar ? 'رجوع' : 'Back'} className="p-3 border rounded-xl">{ar ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}</button><h2 className="text-xl font-bold">{ar ? 'تحليلات حسابك' : 'Your account analytics'}</h2></header>
    <p className="text-sm text-gray-600">{ar ? 'ملخص خاص بصاحب الحساب للاستجابات على منشوراته الأصلية المنشورة. لا تتوفر تصفية مشتركة أو بيانات فردية.' : 'An owner-only summary of responses to your original published posts. Cross-filtering and individual records are unavailable.'}</p>
    {error ? <div role="alert"><p>{ar ? 'تعذر تحميل التحليلات أو لا تملك صلاحية عرضها.' : 'Analytics could not be loaded or you do not have access.'}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="border rounded-xl p-3 mt-3">{ar ? 'إعادة المحاولة' : 'Retry'}</button></div> : !data ? <p role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p> : <>
      <p className="text-2xl font-bold">{Number(data.totalResponses).toLocaleString(i18n.language)} <span className="text-sm font-normal">{ar ? 'استجابة' : 'responses'}</span></p>
      <label className="block" htmlFor="profile-analytics-dimension">{ar ? 'عرض التوزيع حسب' : 'Show distribution by'}</label><select id="profile-analytics-dimension" value={dimension} onChange={event => setDimension(event.target.value)} className="w-full border rounded-xl p-3 bg-white">{Object.entries(choices).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      {distribution?.suppressionReason ? <p className="text-sm rounded-xl bg-blue-50 p-4">{ar ? 'حُجب هذا التوزيع لحماية الفئات التي تضم أقل من ٥ استجابات.' : 'This distribution is withheld to protect groups with fewer than 5 responses.'}</p> : <AggregateBars counts={distribution?.counts || {}} labels={{ Unknown: ar ? 'غير محدد' : 'Unknown' }} locale={i18n.language} />}
    </>}
  </section>;
};
