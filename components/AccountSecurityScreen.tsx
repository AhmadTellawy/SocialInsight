import React, { useEffect, useState } from 'react';
import { ArrowLeft, ShieldCheck, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accountRequest } from '../services/accountApi';
import { sanitizeOtpCode } from '../utils/authUi';
import { SignInMethods, securityErrorText, useProtectedAccountAction } from './ReauthenticationDialog';
import { BottomSheet } from './BottomSheet';

interface Session { id: string; current: boolean; deviceLabel: string; createdAt: string; lastUsedAt: string | null; expiresAt: string }
export const AccountSecurityScreen = ({ onBack, onSignedOut }: { onBack: () => void; onSignedOut?: () => void }) => {
  const { i18n } = useTranslation(), ar = i18n.language.startsWith('ar'), { run, dialog } = useProtectedAccountAction();
  const [methods, setMethods] = useState<SignInMethods | null>(null), [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [currentPassword, setCurrentPassword] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [enrollment, setEnrollment] = useState<{secret: string; otpauthUri: string; expiresAt: string} | null>(null), [code, setCode] = useState(''), [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [mfaAction, setMfaAction] = useState<'disable' | 'recovery' | null>(null), [revokeTarget, setRevokeTarget] = useState<Session | 'others' | null>(null);
  const label = (arabic: string, english: string) => ar ? arabic : english;
  const load = async () => {
    setLoading(true); setError('');
    try { const [access, devices] = await Promise.all([accountRequest<SignInMethods>('/auth/methods'), accountRequest<{sessions: Session[]}>('/auth/sessions')]); setMethods(access); setSessions(devices.sessions); }
    catch (e) { setError(securityErrorText(e, ar)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const act = async (action: () => Promise<void>, success?: string) => {
    if (busy) return; setBusy(true); setError(''); setNotice(''); setMfaAction(null); setRevokeTarget(null);
    try { if (await run(action)) { if (success) setNotice(success); await load(); } }
    catch (e) { setError(securityErrorText(e, ar)); } finally { setBusy(false); }
  };
  const validPassword = password.length >= 8 && password.length <= 128 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[!@#$%^&*]/.test(password);
  const changePassword = (event: React.FormEvent) => { event.preventDefault(); void act(async () => {
    await accountRequest('/auth/password', 'PUT', { password, ...(methods?.hasPassword ? {currentPassword} : {}) });
    setPassword(''); setConfirmation(''); setCurrentPassword('');
  }, label('تم تحديث كلمة المرور وتسجيل خروج الأجهزة الأخرى.', 'Password updated. Other devices were signed out.')); };
  const button = 'min-h-11 rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50';
  const field = 'min-h-12 w-full rounded-xl border border-gray-300 px-3 py-2';
  const date = (value: string) => new Date(value).toLocaleString(ar ? 'ar' : 'en', { dateStyle: 'medium', timeStyle: 'short' });

  return <div dir={ar ? 'rtl' : 'ltr'} className="flex h-full flex-col bg-gray-50">
    <header className="flex min-h-14 items-center border-b bg-white px-4"><button type="button" onClick={onBack} className="flex h-11 w-11 items-center justify-center" aria-label={label('رجوع', 'Back')}><ArrowLeft className="rtl:rotate-180" /></button><h1 className="text-lg font-bold">{label('كلمة المرور والأمان', 'Password and security')}</h1></header>
    <main className="flex-1 space-y-5 overflow-y-auto p-5 pb-12">
      {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</div>}
      {notice && <p role="status" className="rounded-xl bg-green-50 p-3 text-green-800">{notice}</p>}
      {loading && <p role="status">{label('جارٍ التحميل…', 'Loading…')}</p>}
      {!methods && !loading && <button className={button} onClick={load}>{label('إعادة المحاولة', 'Retry')}</button>}
      {methods && <>
        <section className="space-y-3 rounded-2xl border bg-white p-5" aria-labelledby="password-heading">
          <h2 id="password-heading" className="font-bold">{methods.hasPassword ? label('تغيير كلمة المرور', 'Change password') : label('إضافة كلمة مرور', 'Add a password')}</h2>
          {!methods.hasPassword && !methods.emailVerified && <p className="text-sm text-amber-800">{label('أضف بريدًا إلكترونيًا موثقًا من صفحة وسائل الدخول أولًا.', 'Add and verify an email in Account access first.')}</p>}
          <form onSubmit={changePassword} className="space-y-3">
            {methods.hasPassword && <label className="block text-sm">{label('كلمة المرور الحالية', 'Current password')}<input required value={currentPassword} type="password" autoComplete="current-password" onChange={e => setCurrentPassword(e.target.value)} className={field} /></label>}
            <label className="block text-sm">{label('كلمة المرور الجديدة', 'New password')}<input required maxLength={128} value={password} type="password" autoComplete="new-password" onChange={e => setPassword(e.target.value)} className={field} /></label>
            <p className="text-xs leading-relaxed text-gray-600">{label('8 أحرف على الأقل، تتضمن حرفًا إنجليزيًا كبيرًا وصغيرًا ورقمًا ورمزًا من !@#$%^&*.', 'At least 8 characters, with an uppercase and lowercase English letter, a number, and a symbol from !@#$%^&*.')}</p>
            <label className="block text-sm">{label('تأكيد كلمة المرور', 'Confirm password')}<input required maxLength={128} value={confirmation} type="password" autoComplete="new-password" onChange={e => setConfirmation(e.target.value)} className={field} /></label>
            {confirmation && confirmation !== password && <p className="text-sm text-red-700">{label('كلمتا المرور غير متطابقتين.', 'The passwords do not match.')}</p>}
            <button disabled={busy || !validPassword || password !== confirmation || (methods.hasPassword ? !currentPassword : !methods.emailVerified)} className={`${button} w-full bg-blue-600 text-white`}>{label('حفظ كلمة المرور', 'Save password')}</button>
          </form>
        </section>
        <section className="space-y-3 rounded-2xl border bg-white p-5" aria-labelledby="mfa-heading">
          <h2 id="mfa-heading" className="flex items-center gap-2 font-bold"><ShieldCheck size={20}/>{label('التحقق بخطوتين', 'Two-step verification')}</h2>
          <p className="text-sm text-gray-600">{label('استخدم تطبيق مصادقة لإنشاء رمز عند كل تسجيل دخول، حتى عند الدخول عبر Google أو Facebook.', 'Use an authenticator app for a code at every sign-in, including Google and Facebook sign-in.')}</p>
          <p className="font-semibold">{methods.mfa.enabled ? label('مفعّل', 'Enabled') : label('غير مفعّل', 'Not enabled')}</p>
          {!methods.mfa.available && <p className="text-sm text-amber-800">{label('خدمة التحقق بخطوتين غير متاحة حاليًا. حاول لاحقًا.', 'Two-step verification is currently unavailable. Try again later.')}</p>}
          {!methods.mfa.enabled && !enrollment && <button disabled={busy || !methods.mfa.available} className={button} onClick={() => act(async () => { setEnrollment(await accountRequest('/auth/mfa/enrollment', 'POST')); setCode(''); })}>{label('إعداد تطبيق المصادقة', 'Set up authenticator app')}</button>}
          {enrollment && <div className="space-y-3 rounded-xl bg-blue-50 p-4">
            <p className="text-sm">{label('أضف مفتاح الإعداد التالي إلى تطبيق المصادقة، ثم أدخل الرمز لإكمال التفعيل. لا تشارك المفتاح.', 'Add this setup key to your authenticator app, then enter its code to enable verification. Do not share the key.')}</p>
            <code dir="ltr" className="block select-all break-all rounded-lg bg-white p-3 text-sm">{enrollment.secret}</code>
            <a className="inline-block min-h-11 py-3 text-blue-700 underline" href={enrollment.otpauthUri}>{label('فتح في تطبيق المصادقة', 'Open in authenticator app')}</a>
            <label className="block text-sm">{label('رمز التحقق', 'Verification code')}<input value={code} inputMode="numeric" autoComplete="one-time-code" onChange={e => setCode(sanitizeOtpCode(e.target.value))} maxLength={6} className={field} dir="ltr" /></label>
            <button disabled={busy || code.length !== 6} className={`${button} bg-blue-600 text-white`} onClick={() => act(async () => { const result = await accountRequest<{recoveryCodes: string[]}>('/auth/mfa/enrollment/confirm', 'POST', {code}); setRecoveryCodes(result.recoveryCodes); setEnrollment(null); setCode(''); }, label('تم تفعيل التحقق بخطوتين.', 'Two-step verification enabled.'))}>{label('تفعيل', 'Enable')}</button>
            <button disabled={busy} className={`${button} ms-2`} onClick={() => { setEnrollment(null); setCode(''); }}>{label('إلغاء الإعداد', 'Cancel setup')}</button>
          </div>}
          {methods.mfa.enabled && <div className="flex flex-wrap gap-2"><button disabled={busy} className={button} onClick={() => { setMfaAction('recovery'); setCode(''); }}>{label('إنشاء رموز استرداد جديدة', 'Generate new recovery codes')}</button><button disabled={busy} className={`${button} text-red-700`} onClick={() => { setMfaAction('disable'); setCode(''); }}>{label('إيقاف التحقق بخطوتين', 'Turn off two-step verification')}</button></div>}
        </section>
        <section className="space-y-3 rounded-2xl border bg-white p-5" aria-labelledby="sessions-heading">
          <h2 id="sessions-heading" className="flex items-center gap-2 font-bold"><Smartphone size={20}/>{label('الأجهزة والجلسات', 'Devices and sessions')}</h2>
          <p className="text-xs text-gray-600">{label('الأسماء تقريبية بحسب المتصفح. آخر نشاط قد يتأخر بضع دقائق.', 'Device names are approximate. Last activity may lag by a few minutes.')}</p>
          <button disabled={busy || !sessions.some(s => !s.current)} className={button} onClick={() => setRevokeTarget('others')}>{label('تسجيل خروج الأجهزة الأخرى', 'Sign out other devices')}</button>
          <ul className="divide-y">{sessions.map(session => <li key={session.id} className="space-y-2 py-4"><p className="font-semibold">{session.deviceLabel} {session.current && <span className="text-sm text-green-700">{label('• هذا الجهاز', '• This device')}</span>}</p><p className="text-xs text-gray-600">{label('آخر نشاط: ', 'Last active: ')}{date(session.lastUsedAt || session.createdAt)}</p><button disabled={busy} className={`${button} text-red-700`} onClick={() => setRevokeTarget(session)}>{label('تسجيل خروج', 'Sign out')}</button></li>)}</ul>
        </section>
      </>}
    </main>
    <BottomSheet isOpen={Boolean(mfaAction)} onClose={() => { if (!busy) setMfaAction(null); }} title={mfaAction === 'disable' ? label('إيقاف التحقق بخطوتين', 'Turn off two-step verification') : label('استبدال رموز الاسترداد', 'Replace recovery codes')}>
      <div className="space-y-3 p-2"><p className="text-sm">{mfaAction === 'disable' ? label('سيصبح الدخول ممكنًا دون رمز المصادقة. أدخل رمزًا حاليًا أو رمز استرداد لتأكيد الإيقاف.', 'Sign-in will no longer require an authenticator code. Enter a current code or recovery code to confirm.') : label('ستتوقف رموز الاسترداد السابقة عن العمل. أدخل رمزًا حاليًا أو رمز استرداد للمتابعة.', 'Previous recovery codes will stop working. Enter a current code or recovery code to continue.')}</p><label className="block text-sm">{label('رمز المصادقة أو الاسترداد', 'Authenticator or recovery code')}<input value={code} onChange={e => setCode(e.target.value)} maxLength={40} autoComplete="one-time-code" className={field} dir="ltr" /></label><button disabled={busy || !code.trim()} className={`${button} w-full`} onClick={() => act(async () => { if (mfaAction === 'disable') await accountRequest('/auth/mfa', 'DELETE', {code}); else { const result = await accountRequest<{recoveryCodes: string[]}>('/auth/mfa/recovery-codes', 'POST', {code}); setRecoveryCodes(result.recoveryCodes); } setMfaAction(null); setCode(''); }, label('تم تحديث إعدادات الأمان.', 'Security settings updated.'))}>{label('تأكيد', 'Confirm')}</button></div>
    </BottomSheet>
    <BottomSheet isOpen={recoveryCodes.length > 0} onClose={() => {}} title={label('احفظ رموز الاسترداد', 'Save your recovery codes')}>
      <div className="space-y-4 p-2"><p className="text-sm">{label('تظهر هذه الرموز مرة واحدة. احفظها في مكان آمن خارج هذا الجهاز. كل رمز يعمل مرة واحدة.', 'These codes are shown once. Store them securely outside this device. Each code works only once.')}</p><pre dir="ltr" className="select-all whitespace-pre-wrap rounded-xl bg-gray-100 p-4 text-sm">{recoveryCodes.join('\n')}</pre><button className={`${button} w-full`} onClick={() => setRecoveryCodes([])}>{label('حفظت الرموز في مكان آمن', 'I saved these codes securely')}</button></div>
    </BottomSheet>
    <BottomSheet isOpen={Boolean(revokeTarget)} onClose={() => { if (!busy) setRevokeTarget(null); }} title={label('تأكيد تسجيل الخروج', 'Confirm sign-out')}>
      <div className="space-y-4 p-2"><p>{revokeTarget === 'others' ? label('ستحتاج الأجهزة الأخرى إلى تسجيل الدخول مجددًا. ستبقى هذه الجلسة مفتوحة.', 'Other devices will need to sign in again. This session will stay signed in.') : label('ستُغلق الجلسة المحددة فورًا.', 'The selected session will be signed out immediately.')}</p><button disabled={busy} className={`${button} w-full text-red-700`} onClick={() => act(async () => { const result = revokeTarget === 'others' ? await accountRequest<{currentRevoked?: boolean}>('/auth/sessions/revoke-others', 'POST') : await accountRequest<{currentRevoked?: boolean}>(`/auth/sessions/${(revokeTarget as Session).id}`, 'DELETE'); setRevokeTarget(null); if (result.currentRevoked) { if (onSignedOut) onSignedOut(); else window.location.reload(); } }, label('تم تسجيل الخروج.', 'Signed out.'))}>{label('تسجيل خروج', 'Sign out')}</button><button disabled={busy} className={`${button} w-full`} onClick={() => setRevokeTarget(null)}>{label('إلغاء', 'Cancel')}</button></div>
    </BottomSheet>
    {dialog}
  </div>;
};
