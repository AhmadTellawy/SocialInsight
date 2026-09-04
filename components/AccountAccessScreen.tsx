import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Chrome, Facebook, Loader2, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UserProfile } from '../types';
import { ApiError, api } from '../services/api';
import { isCompleteOtpCode, isEmailCandidate, OAuthFeedback, oauthFeedbackTranslationKey, sanitizeOtpCode } from '../utils/authUi';

interface AccountAccessScreenProps {
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => void;
  onBack: () => void;
  oauthFeedback?: OAuthFeedback | null;
}

type EmailFlow = 'verify' | 'change' | null;
type BusyAction = 'verify-request' | 'verify-confirm' | 'change-request' | 'change-confirm' | 'google' | 'facebook' | null;

const CODE_COOLDOWN_SECONDS = 60;

export const AccountAccessScreen: React.FC<AccountAccessScreenProps> = ({
  userProfile,
  onUpdateProfile,
  onBack,
  oauthFeedback
}) => {
  const { t } = useTranslation();
  const [flow, setFlow] = useState<EmailFlow>(null);
  const [code, setCode] = useState('');
  const [nextEmail, setNextEmail] = useState('');
  const [busy, setBusy] = useState<BusyAction>(null);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const currentEmail = userProfile.email?.trim().toLowerCase() || '';
  const hasEmail = currentEmail.length > 0;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (flow) codeInputRef.current?.focus();
  }, [flow]);

  const localError = (value: unknown, fallbackKey: string): string => {
    if (value instanceof ApiError) {
      const knownCodes = ['OTP_COOLDOWN', 'EMAIL_UNAVAILABLE', 'EMAIL_CHANGE_INVALID', 'EMAIL_VERIFICATION_INVALID', 'REAUTHENTICATION_REQUIRED', 'REQUEST_TIMEOUT', 'NETWORK_ERROR'];
      if (value.code && knownCodes.includes(value.code)) {
        return t(`auth.errors.${value.code}`);
      }
    }
    return t(fallbackKey);
  };

  const requestVerification = async () => {
    if (busy || cooldown > 0 || !hasEmail) return;
    setBusy('verify-request');
    setError(null);
    setNotice(null);
    try {
      await api.requestEmailVerification();
      setFlow('verify');
      setCode('');
      setCooldown(CODE_COOLDOWN_SECONDS);
      setNotice(t('auth.account.email.codeSent', { email: currentEmail }));
    } catch (requestError) {
      setError(localError(requestError, 'auth.account.email.sendFailed'));
    } finally {
      setBusy(null);
    }
  };

  const confirmVerification = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !isCompleteOtpCode(code)) return;
    setBusy('verify-confirm');
    setError(null);
    try {
      await api.confirmEmailVerification(code);
      const updated = { ...userProfile, emailVerifiedAt: new Date().toISOString() };
      onUpdateProfile(updated);
      setFlow(null);
      setCode('');
      setNotice(t('auth.account.email.verifiedSuccess'));
    } catch (confirmError) {
      setError(localError(confirmError, 'auth.account.email.verifyFailed'));
    } finally {
      setBusy(null);
    }
  };

  const requestChange = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = nextEmail.trim().toLowerCase();
    if (busy || !isEmailCandidate(normalizedEmail) || normalizedEmail === currentEmail) return;
    setBusy('change-request');
    setError(null);
    setNotice(null);
    try {
      await api.requestEmailChange(normalizedEmail);
      setNextEmail(normalizedEmail);
      setFlow('change');
      setCode('');
      setCooldown(CODE_COOLDOWN_SECONDS);
      setNotice(t('auth.account.email.codeSent', { email: normalizedEmail }));
    } catch (requestError) {
      setError(localError(requestError, 'auth.account.email.changeSendFailed'));
    } finally {
      setBusy(null);
    }
  };

  const confirmChange = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !isCompleteOtpCode(code)) return;
    setBusy('change-confirm');
    setError(null);
    try {
      const result = await api.confirmEmailChange(nextEmail, code);
      const updated = { ...userProfile, email: result.email, emailVerifiedAt: new Date().toISOString() };
      onUpdateProfile(updated);
      setFlow(null);
      setCode('');
      setNextEmail('');
      setNotice(t('auth.account.email.changedSuccess'));
    } catch (confirmError) {
      setError(localError(confirmError, 'auth.account.email.changeFailed'));
    } finally {
      setBusy(null);
    }
  };

  const startLink = async (provider: 'google' | 'facebook') => {
    if (busy) return;
    setBusy(provider);
    setError(null);
    setNotice(null);
    try {
      const authorizationUrl = await api.startOAuthLink(provider);
      window.location.assign(authorizationUrl);
    } catch (linkError) {
      setError(localError(linkError, 'auth.account.oauth.startFailed'));
      setBusy(null);
    }
  };

  const resendCurrentCode = flow === 'verify'
    ? requestVerification
    : async () => {
        if (busy || cooldown > 0) return;
        setBusy('change-request');
        setError(null);
        try {
          await api.requestEmailChange(nextEmail);
          setCode('');
          setCooldown(CODE_COOLDOWN_SECONDS);
          setNotice(t('auth.account.email.codeSent', { email: nextEmail }));
        } catch (requestError) {
          setError(localError(requestError, 'auth.account.email.changeSendFailed'));
        } finally {
          setBusy(null);
        }
      };

  const oauthMessage = oauthFeedback
    ? t(oauthFeedbackTranslationKey(oauthFeedback), {
        provider: oauthFeedback.provider ? t(`auth.providers.${oauthFeedback.provider}`) : t('auth.account.oauth.provider')
      })
    : null;

  const codeTarget = flow === 'change' ? nextEmail : currentEmail;
  const isVerified = hasEmail && Boolean(userProfile.emailVerifiedAt);

  return (
    <div className="flex h-full flex-col bg-gray-50 animate-in slide-in-from-right duration-300" dir="auto">
      <header className="sticky top-0 z-30 flex h-14 items-center border-b border-gray-100 bg-white px-4">
        <button type="button" onClick={onBack} aria-label={t('common.back')} className="-ms-2 flex h-11 w-11 items-center justify-center rounded-full text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
          <ArrowLeft size={24} className="rtl:rotate-180" aria-hidden="true" />
        </button>
        <h1 className="ms-2 text-lg font-bold">{t('auth.account.title')}</h1>
      </header>

      <main className="flex-1 space-y-5 overflow-y-auto px-5 py-6 pb-12">
        {(error || notice || oauthMessage) && (
          <div
            role={error || oauthFeedback?.tone === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`flex items-start gap-3 rounded-2xl border p-4 text-sm font-bold ${error || oauthFeedback?.tone === 'error' ? 'border-red-100 bg-red-50 text-red-700' : 'border-green-100 bg-green-50 text-green-800'}`}
          >
            {error || oauthFeedback?.tone === 'error' ? <AlertCircle className="mt-0.5 shrink-0" size={18} aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 shrink-0" size={18} aria-hidden="true" />}
            <p>{error || notice || oauthMessage}</p>
          </div>
        )}

        <section aria-labelledby="account-email-title" className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-blue-50 p-3 text-blue-600"><Mail size={21} aria-hidden="true" /></div>
            <div className="min-w-0 flex-1">
              <h2 id="account-email-title" className="font-black text-gray-900">{t('auth.account.email.title')}</h2>
              <p className="mt-1 break-all text-sm text-gray-600" dir="ltr">{hasEmail ? currentEmail : t('auth.account.email.missing')}</p>
              <span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${isVerified ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                <ShieldCheck size={14} aria-hidden="true" />
                {isVerified ? t('auth.account.email.verified') : t('auth.account.email.unverified')}
              </span>
            </div>
          </div>

          {hasEmail && !isVerified && flow !== 'verify' && (
            <button type="button" onClick={requestVerification} disabled={Boolean(busy) || cooldown > 0} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
              {busy === 'verify-request' && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}
              {t('auth.account.email.sendVerification')}
            </button>
          )}

          {flow === 'verify' && (
            <form onSubmit={confirmVerification} className="mt-5 space-y-3">
              <CodeField value={code} onChange={setCode} inputRef={codeInputRef} label={t('auth.account.email.codeLabel')} />
              <button type="submit" disabled={Boolean(busy) || !isCompleteOtpCode(code)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                {busy === 'verify-confirm' && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}
                {t('auth.account.email.confirmVerification')}
              </button>
            </form>
          )}

          <hr className="my-5 border-gray-100" />
          {flow !== 'change' ? (
            <form onSubmit={requestChange} className="space-y-3">
              <label htmlFor="new-account-email" className="block text-xs font-bold text-gray-600">{t('auth.account.email.newEmail')}</label>
              <input id="new-account-email" type="email" inputMode="email" autoComplete="email" value={nextEmail} onChange={(event) => setNextEmail(event.target.value)} placeholder={t('auth.account.email.newEmailPlaceholder')} className="min-h-12 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              <p className="text-xs leading-relaxed text-gray-500">{t('auth.account.email.changeHelp')}</p>
              <button type="submit" disabled={Boolean(busy) || !isEmailCandidate(nextEmail) || nextEmail.trim().toLowerCase() === currentEmail} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border-2 border-blue-600 px-4 py-3 text-sm font-black text-blue-600 disabled:opacity-50">
                {busy === 'change-request' && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}
                {t(hasEmail ? 'auth.account.email.changeAction' : 'auth.account.email.addAction')}
              </button>
            </form>
          ) : (
            <form onSubmit={confirmChange} className="space-y-3">
              <p className="text-sm text-gray-600">{t('auth.account.email.enterCodeFor', { email: codeTarget })}</p>
              <CodeField value={code} onChange={setCode} inputRef={codeInputRef} label={t('auth.account.email.codeLabel')} />
              <button type="submit" disabled={Boolean(busy) || !isCompleteOtpCode(code)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                {busy === 'change-confirm' && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}
                {t('auth.account.email.confirmChange')}
              </button>
            </form>
          )}

          {flow && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => { setFlow(null); setCode(''); setError(null); }} disabled={Boolean(busy)} className="min-h-11 px-2 text-sm font-bold text-gray-600 disabled:opacity-50">{t('common.cancel')}</button>
              <button type="button" onClick={resendCurrentCode} disabled={Boolean(busy) || cooldown > 0} className="flex min-h-11 items-center gap-2 px-2 text-sm font-bold text-blue-600 disabled:text-gray-400">
                <RefreshCw size={15} className={busy?.endsWith('request') ? 'animate-spin' : ''} aria-hidden="true" />
                {cooldown > 0 ? t('auth.account.email.resendIn', { seconds: cooldown }) : t('auth.account.email.resend')}
              </button>
            </div>
          )}
        </section>

        <section aria-labelledby="linked-accounts-title" className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 id="linked-accounts-title" className="font-black text-gray-900">{t('auth.account.oauth.title')}</h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-500">{t('auth.account.oauth.help')}</p>
          <div className="mt-4 space-y-3">
            <ProviderButton provider="google" busy={busy} onClick={startLink} label={t('auth.account.oauth.linkGoogle')} />
            <ProviderButton provider="facebook" busy={busy} onClick={startLink} label={t('auth.account.oauth.linkFacebook')} />
          </div>
        </section>
      </main>
    </div>
  );
};

const CodeField = ({ value, onChange, inputRef, label }: { value: string; onChange: (value: string) => void; inputRef: React.RefObject<HTMLInputElement | null>; label: string }) => (
  <div>
    <label htmlFor="account-email-code" className="mb-1.5 block text-xs font-bold text-gray-600">{label}</label>
    <input ref={inputRef} id="account-email-code" required type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={value} onChange={(event) => onChange(sanitizeOtpCode(event.target.value))} placeholder="000000" className="min-h-12 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 text-center text-xl font-black tracking-[0.4em] outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" dir="ltr" />
  </div>
);

const ProviderButton = ({ provider, busy, onClick, label }: { provider: 'google' | 'facebook'; busy: BusyAction; onClick: (provider: 'google' | 'facebook') => void; label: string }) => {
  const isBusy = busy === provider;
  const Icon = provider === 'google' ? Chrome : Facebook;
  return (
    <button type="button" onClick={() => onClick(provider)} disabled={Boolean(busy)} aria-busy={isBusy} className={`flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl p-4 text-sm font-bold transition-all disabled:opacity-60 ${provider === 'facebook' ? 'bg-[#1877F2] text-white' : 'border-2 border-gray-100 text-gray-700 hover:bg-gray-50'}`}>
      {isBusy ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : <Icon size={20} className={provider === 'google' ? 'text-red-500' : ''} fill={provider === 'facebook' ? 'currentColor' : 'none'} strokeWidth={provider === 'facebook' ? 0 : 2} aria-hidden="true" />}
      {label}
    </button>
  );
};
