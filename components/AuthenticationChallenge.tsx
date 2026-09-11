import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { sanitizeOtpCode } from '../utils/authUi';

export type LoginChallenge = { kind: 'mfa' | 'reactivation'; expiresAt: string };
export function AuthenticationChallenge({ challenge: initial, onSuccess, onCancel }: {
  challenge: LoginChallenge; onSuccess: (result: unknown) => void; onCancel: () => void;
}) {
  const { i18n } = useTranslation(); const ar = i18n.language.startsWith('ar');
  const tr = (en: string, arabic: string) => ar ? arabic : en;
  const [challenge, setChallenge] = useState(initial);
  const [code, setCode] = useState(''); const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function complete(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const result = await api.completeAuthChallenge(challenge.kind === 'reactivation' ? { reactivate: true } : { code: recovery ? code.trim() : sanitizeOtpCode(code) });
      if (result.challengeRequired) { setChallenge(result.challenge); setCode(''); }
      else if (result.user) onSuccess(result);
      else throw new Error('Invalid authentication result');
    } catch (failure) {
      setError((failure as { code?: string })?.code === 'ACCOUNT_PRIVACY_TRANSITION_PENDING'
        ? tr('Your privacy update is still processing. Wait a moment, then try reactivating again.', 'ما زال تحديث خصوصية حسابك قيد المعالجة. انتظر قليلًا ثم أعد محاولة التفعيل.')
        : tr('Verification failed or expired. Check your code, or return to sign in.', 'فشل التحقق أو انتهت صلاحيته. تحقق من الرمز أو ارجع لتسجيل الدخول.'));
    }
    finally { setBusy(false); }
  }
  return <main dir={ar ? 'rtl' : 'ltr'} className="flex min-h-screen items-center justify-center bg-gray-50 p-4 text-gray-900"><form onSubmit={complete} className="w-full max-w-md space-y-5 rounded-2xl border bg-white p-6">
    <h1 className="text-xl font-bold">{challenge.kind === 'mfa' ? tr('Verify your sign-in', 'التحقق من تسجيل الدخول') : tr('Reactivate your account', 'إعادة تفعيل حسابك')}</h1>
    <p className="text-sm leading-6 text-gray-600">{challenge.kind === 'mfa' ? tr('Enter a code from your authenticator app or use one of your recovery codes.', 'أدخل رمزًا من تطبيق المصادقة أو استخدم أحد رموز الاسترداد.') : tr('Your account is deactivated. Confirm to restore access and make your profile and content available under your privacy settings.', 'حسابك معطّل مؤقتًا. أكّد لاستعادة الوصول وإتاحة ملفك ومحتواك وفق إعدادات الخصوصية.')}</p>
    {challenge.kind === 'mfa' && <><label className="block space-y-2 text-sm"><span>{recovery ? tr('Recovery code','رمز الاسترداد') : tr('Authenticator code','رمز تطبيق المصادقة')}</span><input autoFocus dir="ltr" autoComplete="one-time-code" inputMode={recovery ? 'text' : 'numeric'} value={code} onChange={e => setCode(recovery ? e.target.value.slice(0,100) : sanitizeOtpCode(e.target.value))} className="min-h-12 w-full rounded-xl border p-3"/></label><button type="button" className="min-h-12 text-sm text-blue-700 underline" onClick={() => { setRecovery(!recovery); setCode(''); }}>{recovery ? tr('Use authenticator','استخدام تطبيق المصادقة') : tr('Use a recovery code','استخدام رمز استرداد')}</button></>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button disabled={busy || challenge.kind === 'mfa' && !code.trim()} className="min-h-12 w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-40">{busy ? tr('Verifying…','جارٍ التحقق…') : challenge.kind === 'mfa' ? tr('Verify','تحقق') : tr('Reactivate account','إعادة تفعيل الحساب')}</button>
    <button type="button" disabled={busy} className="min-h-12 w-full rounded-xl border p-3" onClick={onCancel}>{tr('Back to sign in','العودة لتسجيل الدخول')}</button>
  </form></main>;
}
