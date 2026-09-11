import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from './BottomSheet';
import { accountRequest } from '../services/accountApi';

export interface SignInMethods {
  hasPassword: boolean; emailVerified: boolean;
  providers: { provider: 'google' | 'facebook'; linked: boolean }[];
  mfa: { enabled: boolean; available: boolean }; recentAuthUntil: string | null;
}
export const securityErrorText = (error: unknown, ar: boolean): string => {
  const code = (error as { code?: string })?.code;
  const messages: Record<string, [string, string]> = {
    INVALID_CREDENTIALS: ['كلمة المرور غير صحيحة.', 'The password is incorrect.'],
    MFA_CODE_INVALID: ['الرمز غير صحيح أو استُخدم. انتظر الرمز التالي أو استخدم رمز استرداد آخر.', 'The code is invalid or already used. Wait for the next code or use another recovery code.'],
    MFA_ENROLLMENT_EXPIRED: ['انتهت صلاحية الإعداد. ابدأ الإعداد من جديد.', 'Setup expired. Start setup again.'],
    MFA_NOT_CONFIGURED: ['التحقق بخطوتين غير متاح حاليًا. حاول لاحقًا.', 'Two-step verification is currently unavailable. Try again later.'],
    VERIFIED_EMAIL_REQUIRED: ['أضف بريدًا إلكترونيًا موثقًا أولًا.', 'Add and verify an email address first.'],
    LAST_SIGN_IN_METHOD: ['أضف وسيلة دخول أخرى قبل إزالة هذه الوسيلة.', 'Add another sign-in method before removing this one.'],
    AUTH_CHALLENGE_EXPIRED: ['انتهت صلاحية التحقق. ابدأ التحقق من جديد.', 'Verification expired. Start verification again.'],
    REAUTHENTICATION_REQUIRED: ['تحقق من هويتك للمتابعة.', 'Verify your identity to continue.'],
    RATE_LIMITED: ['محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.', 'Too many attempts. Wait a little and try again.'],
    NETWORK_ERROR: ['تعذر الاتصال. تحقق من الاتصال وحاول مجددًا.', 'Unable to connect. Check your connection and try again.'],
    REQUEST_TIMEOUT: ['انتهت مهلة الطلب. تحقق من الحالة قبل إعادة المحاولة.', 'The request timed out. Check the current status before retrying.']
  };
  return messages[code || '']?.[ar ? 0 : 1] || (ar ? 'تعذر إكمال العملية. حاول مجددًا.' : 'The action could not be completed. Try again.');
};

export const ReauthenticationDialog = ({ open, onClose, onVerified }: { open: boolean; onClose: () => void; onVerified: () => void }) => {
  const { i18n } = useTranslation(), ar = i18n.language.startsWith('ar');
  const [methods, setMethods] = useState<SignInMethods | null>(null), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [mfa, setMfa] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const popup = useRef<Window | null>(null), verified = useRef(onVerified);
  verified.current = onVerified;
  const reload = async () => { setError(''); try { setMethods(await accountRequest<SignInMethods>('/auth/methods')); } catch (e) { setError(securityErrorText(e, ar)); } };
  useEffect(() => {
    if (!open) return;
    setPassword(''); setCode(''); setMfa(false); setMethods(null); setBusy(false); void reload();
    const listener = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup.current || event.data?.type !== 'opiniup:reauth') return;
      popup.current?.close(); popup.current = null; setBusy(false);
      if (event.data.status === 'reauth_challenge') { setMfa(true); return; }
      if (event.data.status !== 'reauthenticated') { setError(ar ? 'تعذر التحقق من الحساب المرتبط.' : 'The linked account could not be verified.'); return; }
      try {
        const result = await accountRequest<SignInMethods>('/auth/methods');
        if (!result.recentAuthUntil || Date.parse(result.recentAuthUntil) <= Date.now()) throw new Error('expired');
        verified.current();
      } catch (e) { setError(securityErrorText(e, ar)); }
    };
    window.addEventListener('message', listener);
    const timer = window.setInterval(() => { if (popup.current?.closed) { popup.current = null; setBusy(false); } }, 500);
    return () => { window.removeEventListener('message', listener); window.clearInterval(timer); popup.current?.close(); popup.current = null; };
  }, [open, ar]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await accountRequest<{ challengeRequired?: boolean; success?: boolean }>(mfa ? '/auth/challenge/complete' : '/auth/reauthenticate', 'POST', mfa ? { code } : { password });
      setPassword(''); setCode('');
      if (result.challengeRequired) setMfa(true); else if (result.success) onVerified();
    } catch (e) { setError(securityErrorText(e, ar)); } finally { setBusy(false); }
  };
  const oauth = async (provider: string) => {
    setError('');
    const opened = window.open('about:blank', 'opiniup-reauthentication', 'popup,width=520,height=720');
    if (!opened) { setError(ar ? 'اسمح بالنوافذ المنبثقة لإكمال التحقق مع الاحتفاظ بتعديلاتك.' : 'Allow pop-ups to verify your account while keeping your changes.'); return; }
    popup.current = opened; setBusy(true);
    try { const result = await accountRequest<{authorizationUrl: string}>(`/auth/oauth/${provider}/reauthenticate`, 'POST'); opened.location.assign(result.authorizationUrl); }
    catch (e) { opened.close(); popup.current = null; setBusy(false); setError(securityErrorText(e, ar)); }
  };
  return <BottomSheet isOpen={open} onClose={() => { if (!busy) onClose(); }} title={ar ? 'تأكيد هويتك' : 'Verify your identity'}>
    <div dir={ar ? 'rtl' : 'ltr'} className="space-y-4 p-2">
      <p className="text-sm text-gray-600">{ar ? 'تعديلاتك محفوظة مؤقتًا في هذه الشاشة. أكمل التحقق لمتابعة العملية.' : 'Your changes stay in this screen. Verify your identity to continue the action.'}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!methods && <button type="button" onClick={reload} className="min-h-11 text-blue-600">{ar ? 'تحميل وسائل التحقق / إعادة المحاولة' : 'Load verification methods / retry'}</button>}
      {(mfa || methods?.hasPassword) && <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm font-semibold" htmlFor="reauth-proof">{mfa ? (ar ? 'رمز تطبيق المصادقة أو رمز الاسترداد' : 'Authenticator or recovery code') : (ar ? 'كلمة المرور الحالية' : 'Current password')}</label>
        <input id="reauth-proof" autoFocus required type={mfa ? 'text' : 'password'} autoComplete={mfa ? 'one-time-code' : 'current-password'} value={mfa ? code : password} onChange={(e) => mfa ? setCode(e.target.value.replace(/[٠-٩]/g, d => String(d.charCodeAt(0)-0x660)).replace(/[۰-۹]/g, d=>String(d.charCodeAt(0)-0x6f0))) : setPassword(e.target.value)} maxLength={mfa ? 40 : 128} className="min-h-12 w-full rounded-xl border p-3" dir="ltr" />
        <button disabled={busy || !(mfa ? code.trim() : password)} className="min-h-11 w-full rounded-xl bg-blue-600 p-3 font-bold text-white disabled:opacity-50">{busy ? (ar ? 'جارٍ التحقق…' : 'Verifying…') : (ar ? 'تحقق ومتابعة' : 'Verify and continue')}</button>
      </form>}
      {!mfa && methods?.providers.filter(p => p.linked).map(p => <button type="button" key={p.provider} disabled={busy} onClick={() => oauth(p.provider)} className="min-h-11 w-full rounded-xl border p-3 font-semibold disabled:opacity-50">{ar ? 'التحقق عبر' : 'Verify with'} {p.provider === 'google' ? 'Google' : 'Facebook'}</button>)}
      {mfa && <button type="button" disabled={busy} className="min-h-11 text-blue-600" onClick={() => { setMfa(false); setCode(''); setError(''); }}>{ar ? 'بدء التحقق من جديد' : 'Start verification again'}</button>}
      <button type="button" disabled={busy} onClick={onClose} className="min-h-11 w-full rounded-xl border p-3 disabled:opacity-50">{ar ? 'إلغاء' : 'Cancel'}</button>
    </div>
  </BottomSheet>;
};

export const useProtectedAccountAction = () => {
  const [open, setOpen] = useState(false);
  const pending = useRef<{ action: () => Promise<void>; resolve: (value: boolean) => void; reject: (error: unknown) => void } | null>(null);
  useEffect(() => () => { pending.current?.resolve(false); pending.current = null; }, []);
  const run = async (action: () => Promise<void>): Promise<boolean> => {
    try { await action(); return true; }
    catch (error) {
      if ((error as {code?: string})?.code !== 'REAUTHENTICATION_REQUIRED' || pending.current) throw error;
      return new Promise<boolean>((resolve, reject) => { pending.current = { action, resolve, reject }; setOpen(true); });
    }
  };
  const dialog = <ReauthenticationDialog open={open} onClose={() => { pending.current?.resolve(false); pending.current = null; setOpen(false); }} onVerified={async () => {
    const request = pending.current; pending.current = null; setOpen(false);
    if (!request) return;
    try { await request.action(); request.resolve(true); } catch (error) { request.reject(error); }
  }} />;
  return { run, dialog };
};
