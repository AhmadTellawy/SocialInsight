import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { UserProfile } from '../types';
import { API_BASE_URL, ApiError, authFetch } from '../services/api';
import { accountApi } from '../services/accountApi';
import { BottomSheet } from './BottomSheet';
import { useProtectedAccountAction, securityErrorText } from './ReauthenticationDialog';

export function AccountDataScreen({ userProfile: _profile, onBack, onSessionEnded }: { userProfile: UserProfile; onBack: () => void; onSessionEnded: () => void }) {
  const { i18n } = useTranslation(), ar = i18n.language.startsWith('ar');
  const tr = (en: string, arabic: string) => ar ? arabic : en;
  const { run, dialog } = useProtectedAccountAction();
  const [confirm, setConfirm] = useState<'deactivate' | 'delete' | null>(null);
  const [typed, setTyped] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const button = 'min-h-12 rounded-xl border px-4 py-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40';
  const showError = (error: unknown) => {
    const code = (error as ApiError)?.code;
    setError(code === 'GROUP_OWNERSHIP_REQUIRED' ? tr('Transfer ownership or delete groups where you are the only active owner, then try again.', 'انقل الملكية أو احذف المجموعات التي أنت مالكها النشط الوحيد، ثم أعد المحاولة.')
      : code === 'PRIVACY_TRANSITION_PENDING' ? tr('Your privacy update is still processing. Try again when it completes.', 'ما زال تحديث الخصوصية قيد المعالجة. أعد المحاولة عند اكتماله.') : securityErrorText(error, ar));
  };
  async function exportData() {
    setBusy(true); setError(''); setNotice('');
    try { await run(async () => {
      const response = await authFetch(`${API_BASE_URL}/account/export`, { timeoutMs: 60_000 });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new ApiError('Export failed', response.status, payload.code); }
      const blob = await response.blob();
      // A truncated stream must never be offered as a successful export.
      JSON.parse(await blob.text());
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'opiniup-account.json'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice(tr('Your account export is ready. Keep this file private.', 'ملف حسابك جاهز للتنزيل. احتفظ به في مكان خاص.'));
    }); } catch (e) { showError(e); } finally { setBusy(false); }
  }
  async function finishAction() {
    if (!confirm || busy) return;
    const action = confirm; setConfirm(null); setTyped(''); setBusy(true); setError('');
    try { await run(async () => { if (action === 'delete') await accountApi.deleteAccount(); else await accountApi.deactivate(); onSessionEnded(); }); }
    catch (e) { showError(e); } finally { setBusy(false); }
  }
  return <main className="h-full overflow-y-auto bg-gray-50 text-gray-900" dir={ar ? 'rtl' : 'ltr'}>
    <header className="flex items-center gap-3 border-b bg-white p-3"><button className={button} onClick={onBack} disabled={busy} aria-label={tr('Back','رجوع')}><ArrowLeft className={ar ? 'rotate-180' : ''}/></button><h1 className="text-lg font-bold">{tr('Your data and account','بياناتك وحسابك')}</h1></header>
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-24">
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
      <section className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="font-bold">{tr('Download your information','تنزيل معلوماتك')}</h2><p className="text-sm leading-6 text-gray-600">{tr('Download your profile, settings, posts, comments, responses and account relationships as JSON. This file contains personal information. Media entries contain information about your files; this download does not include the image files themselves. It is not a copy of every operational record held by the service.', 'نزّل ملفك وإعداداتك ومنشوراتك وتعليقاتك وإجاباتك وعلاقات حسابك بصيغة JSON. يحتوي الملف على معلومات شخصية. تتضمن سجلات الوسائط معلومات عن ملفاتك، ولا يشمل هذا التنزيل ملفات الصور نفسها. ولا يمثّل نسخة من كل السجلات التشغيلية لدى الخدمة.')}</p><button disabled={busy} className={button} onClick={exportData}>{tr('Download information','تنزيل المعلومات')}</button></section>
      <section className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="font-bold">{tr('Deactivate temporarily','تعطيل مؤقت')}</h2><p className="text-sm leading-6 text-gray-600">{tr('Hide your account and its posts, sign out all sessions and remove device notifications. Your data stays saved. Sign in and confirm reactivation to return. Previously cached or copied media may remain outside the service.', 'أخفِ حسابك ومنشوراته وأنهِ جميع الجلسات وأزل تسجيل إشعارات الأجهزة. تبقى بياناتك محفوظة. سجّل الدخول وأكّد إعادة التفعيل للعودة. قد تبقى نسخ من الصور محفوظة أو منسوخة خارج الخدمة.')}</p><button disabled={busy} className={button} onClick={() => setConfirm('deactivate')}>{tr('Deactivate account','تعطيل الحساب')}</button></section>
      <section className="space-y-3 rounded-2xl border border-red-200 bg-white p-5"><h2 className="font-bold text-red-700">{tr('Delete account','حذف الحساب')}</h2><p className="text-sm leading-6 text-gray-600">{tr('This permanently removes your profile, sign-in methods, demographics and private account settings. Published contributions and survey answers may be retained for conversation and result integrity, with the account shown as deleted. Text you wrote may still contain personal information. Moderation reports may be retained. Media removal is processed with automatic retries.', 'يزيل هذا الإجراء نهائيًا ملفك ووسائل الدخول وبياناتك الديموغرافية وإعدادات حسابك الخاصة. قد تبقى المساهمات المنشورة وإجابات الاستبيانات للحفاظ على المحادثات والنتائج، مع إظهار الحساب كمحذوف. قد تتضمن النصوص التي كتبتها معلومات شخصية. قد تُحتفظ ببلاغات الإشراف. تُعالج إزالة الوسائط مع إعادة المحاولة تلقائيًا.')}</p><button disabled={busy} className={`${button} text-red-700`} onClick={() => setConfirm('delete')}>{tr('Delete account permanently','حذف الحساب نهائيًا')}</button></section>
    </div>
    {confirm && <BottomSheet isOpen onClose={() => setConfirm(null)} title={confirm === 'delete' ? tr('Confirm permanent deletion','تأكيد الحذف النهائي') : tr('Confirm deactivation','تأكيد التعطيل')}><div className="space-y-4 p-3" dir={ar ? 'rtl' : 'ltr'}><p className="text-sm">{confirm === 'delete' ? tr('This cannot be undone. Type DELETE to confirm.', 'لا يمكن التراجع عن هذا الإجراء. اكتب DELETE للتأكيد.') : tr('You will be signed out. Sign in and confirm reactivation to return.', 'سيتم تسجيل خروجك. سجّل الدخول وأكّد إعادة التفعيل للعودة.')}</p>{confirm === 'delete' && <input aria-label={tr('Type DELETE','اكتب DELETE')} dir="ltr" value={typed} onChange={e => setTyped(e.target.value)} className="min-h-12 w-full rounded-xl border p-3" autoComplete="off"/>}<button disabled={confirm === 'delete' && typed.trim().toUpperCase() !== 'DELETE'} className={`${button} w-full bg-red-700 text-white`} onClick={finishAction}>{tr('Confirm','تأكيد')}</button><button className={`${button} w-full`} onClick={() => setConfirm(null)}>{tr('Cancel','إلغاء')}</button></div></BottomSheet>}
    {dialog}
  </main>;
}
