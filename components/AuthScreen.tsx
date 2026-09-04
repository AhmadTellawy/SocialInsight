import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Chrome, Facebook, Loader2, Lock, LogIn, Mail, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { SignUpFlow } from './SignUpFlow';
import { isCompleteOtpCode, sanitizeOtpCode } from '../utils/authUi';

interface AuthScreenProps {
    onAuthSuccess: (user: any) => void;
    initialViewMode?: 'flow' | 'login';
    initialError?: string | null;
}

type ViewMode = 'flow' | 'login' | 'reset-request' | 'reset-confirm';
type SocialProvider = 'google' | 'facebook';

const fieldClassName = 'w-full bg-gray-50 border border-gray-200 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 rounded-2xl ps-12 pe-4 py-4 outline-none transition-all font-medium text-gray-900 placeholder:text-gray-400';

export const AuthScreen: React.FC<AuthScreenProps> = ({
    onAuthSuccess,
    initialViewMode = 'flow',
    initialError = null
}) => {
    const { t } = useTranslation();
    const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
    const [isLoading, setIsLoading] = useState(false);
    const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(null);
    const [error, setError] = useState<string | null>(initialError);
    const [notice, setNotice] = useState<string | null>(null);
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [resetCode, setResetCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [resetResendCooldown, setResetResendCooldown] = useState(0);
    const [isResending, setIsResending] = useState(false);

    useEffect(() => {
        if (resetResendCooldown <= 0) return;
        const timer = window.setInterval(() => setResetResendCooldown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [resetResendCooldown]);

    const showView = (nextView: ViewMode) => {
        setError(null);
        setNotice(null);
        setViewMode(nextView);
    };

    const handleLoginSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (isLoading || socialLoading) return;
        setIsLoading(true);
        setError(null);
        try {
            const result = await api.login({ identifier: identifier.trim(), password });
            onAuthSuccess(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('auth.login.failed'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleSocialLogin = async (provider: SocialProvider) => {
        if (socialLoading || isLoading) return;
        setSocialLoading(provider);
        setError(null);
        try {
            const authorizationUrl = await api.startOAuth(provider);
            window.location.assign(authorizationUrl);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('auth.oauth.startFailed', { provider: t(`auth.providers.${provider}`) }));
            setSocialLoading(null);
        }
    };

    const handleResetRequest = async (event: React.FormEvent) => {
        event.preventDefault();
        if (isLoading) return;
        setIsLoading(true);
        setError(null);
        try {
            await api.requestPasswordReset(identifier.trim());
            setNotice(t('auth.reset.codeSent'));
            setResetResendCooldown(60);
            setViewMode('reset-confirm');
        } catch (err) {
            setError(err instanceof Error ? err.message : t('auth.reset.requestFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetConfirm = async (event: React.FormEvent) => {
        event.preventDefault();
        if (isLoading) return;
        setIsLoading(true);
        setError(null);
        try {
            await api.confirmPasswordReset(identifier.trim(), resetCode, newPassword);
            setPassword('');
            setResetCode('');
            setNewPassword('');
            setNotice(t('auth.reset.success'));
            setViewMode('login');
        } catch (err) {
            setError(err instanceof Error ? err.message : t('auth.reset.confirmFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetResend = async () => {
        if (isLoading || isResending || resetResendCooldown > 0) return;
        setIsResending(true);
        setError(null);
        try {
            await api.requestPasswordReset(identifier.trim());
            setResetCode('');
            setResetResendCooldown(60);
            setNotice(t('auth.reset.codeResent'));
        } catch (err) {
            setError(err instanceof Error ? err.message : t('auth.reset.requestFailed'));
        } finally {
            setIsResending(false);
        }
    };

    if (viewMode === 'flow') {
        return <SignUpFlow onComplete={onAuthSuccess} onCancel={() => showView('login')} />;
    }

    const isResetRequest = viewMode === 'reset-request';
    const isResetConfirm = viewMode === 'reset-confirm';

    return (
        <div className="min-h-screen bg-[#FAFAFA] flex flex-col items-center justify-center p-4 sm:p-6 animate-in fade-in duration-500 font-sans">
            <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:shadow-[0_20px_40px_rgb(0,0,0,0.08)] p-6 sm:p-10 border border-gray-100 flex flex-col relative">
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

                <button
                    type="button"
                    onClick={() => showView(isResetRequest || isResetConfirm ? 'login' : 'flow')}
                    aria-label={isResetRequest || isResetConfirm ? t('auth.backToSignIn') : t('auth.backToWelcome')}
                    className="flex items-center gap-2 text-gray-500 hover:text-gray-900 mb-7 transition-colors self-start z-10 min-h-11"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} className="rtl:rotate-180" aria-hidden="true" />
                    <span className="text-xs font-bold uppercase tracking-[0.2em]">{t('common.back')}</span>
                </button>

                <div className="mb-8 text-center z-10">
                    <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight mb-3">
                        {isResetRequest ? t('auth.reset.requestTitle') : isResetConfirm ? t('auth.reset.confirmTitle') : t('auth.login.title')}
                    </h1>
                    <p className="text-gray-500 text-sm font-medium">
                        {isResetRequest
                            ? t('auth.reset.requestDescription')
                            : isResetConfirm
                                ? t('auth.reset.confirmDescription')
                                : t('auth.login.description')}
                    </p>
                </div>

                {error && (
                    <div role="alert" className="mb-5 p-4 bg-red-50 border border-red-100 rounded-2xl text-red-700 text-sm font-bold flex items-start gap-3 z-10">
                        <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                        <p>{error}</p>
                    </div>
                )}
                {notice && (
                    <div role="status" className="mb-5 p-4 bg-green-50 border border-green-100 rounded-2xl text-green-800 text-sm font-bold flex items-start gap-3 z-10">
                        <CheckCircle2 size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                        <p>{notice}</p>
                    </div>
                )}

                <form onSubmit={isResetRequest ? handleResetRequest : isResetConfirm ? handleResetConfirm : handleLoginSubmit} className="space-y-5 z-10">
                    <div className="space-y-1.5">
                        <label htmlFor="auth-identifier" className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ps-1">
                            {isResetRequest || isResetConfirm ? t('auth.fields.email') : t('auth.fields.identifier')}
                        </label>
                        <div className="relative group">
                            <Mail className="absolute start-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={20} aria-hidden="true" />
                            <input
                                id="auth-identifier"
                                required
                                readOnly={isResetConfirm}
                                type={isResetRequest || isResetConfirm ? 'email' : 'text'}
                                inputMode={isResetRequest || isResetConfirm ? 'email' : 'text'}
                                autoComplete="username"
                                value={identifier}
                                onChange={(event) => setIdentifier(event.target.value)}
                                placeholder={isResetRequest || isResetConfirm ? 'you@example.com' : t('auth.fields.identifierPlaceholder')}
                                className={`${fieldClassName} read-only:text-gray-500`}
                            />
                        </div>
                    </div>

                    {!isResetRequest && !isResetConfirm && (
                        <div className="space-y-1.5">
                            <label htmlFor="auth-password" className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ps-1">{t('auth.fields.password')}</label>
                            <div className="relative group">
                                <Lock className="absolute start-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={20} aria-hidden="true" />
                                <input
                                    id="auth-password"
                                    required
                                    type="password"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    placeholder={t('auth.fields.passwordPlaceholder')}
                                    className={fieldClassName}
                                />
                            </div>
                        </div>
                    )}

                    {isResetConfirm && (
                        <>
                            <div className="space-y-1.5">
                                <label htmlFor="reset-code" className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ps-1">{t('auth.fields.code')}</label>
                                <input
                                    id="reset-code"
                                    required
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    pattern="[0-9]{6}"
                                    maxLength={6}
                                    value={resetCode}
                                    onChange={(event) => setResetCode(sanitizeOtpCode(event.target.value))}
                                    placeholder="000000"
                                    className="w-full bg-gray-50 border border-gray-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-2xl px-4 py-4 outline-none text-center tracking-[0.45em] text-xl font-black"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label htmlFor="reset-new-password" className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ps-1">{t('auth.fields.newPassword')}</label>
                                <div className="relative group">
                                    <Lock className="absolute start-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={20} aria-hidden="true" />
                                    <input
                                        id="reset-new-password"
                                        required
                                        type="password"
                                        minLength={8}
                                        autoComplete="new-password"
                                        value={newPassword}
                                        onChange={(event) => setNewPassword(event.target.value)}
                                        placeholder={t('auth.fields.newPasswordPlaceholder')}
                                        className={fieldClassName}
                                    />
                                </div>
                                <p className="text-xs text-gray-500 ps-1">{t('auth.fields.passwordHelp')}</p>
                            </div>
                        </>
                    )}

                    {!isResetRequest && !isResetConfirm && (
                        <div className="flex justify-end pt-1">
                            <button type="button" onClick={() => showView('reset-request')} className="min-h-11 text-sm font-bold text-blue-600 hover:text-blue-700 hover:underline underline-offset-4">
                                {t('auth.login.forgotPassword')}
                            </button>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading || Boolean(socialLoading) || (isResetConfirm && !isCompleteOtpCode(resetCode))}
                        className="w-full min-h-12 bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase tracking-[0.15em] text-xs shadow-[0_8px_20px_rgb(37,99,235,0.25)] active:scale-[0.98] transition-all disabled:opacity-70 disabled:pointer-events-none flex items-center justify-center gap-3"
                    >
                        {isLoading
                            ? <><Loader2 className="animate-spin" size={18} aria-hidden="true" /> {t('auth.pleaseWait')}</>
                            : isResetRequest
                                ? t('auth.reset.sendCode')
                                : isResetConfirm
                                    ? t('auth.reset.resetPassword')
                                    : <><LogIn size={18} strokeWidth={2.5} aria-hidden="true" /> {t('auth.login.signIn')}</>}
                    </button>
                </form>

                {isResetConfirm && (
                    <button
                        type="button"
                        onClick={handleResetResend}
                        disabled={isLoading || isResending || resetResendCooldown > 0}
                        className="mt-3 flex min-h-11 items-center justify-center gap-2 text-sm font-bold text-blue-600 disabled:text-gray-400"
                    >
                        {isResending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
                        {resetResendCooldown > 0 ? t('auth.reset.resendIn', { seconds: resetResendCooldown }) : t('auth.reset.resend')}
                    </button>
                )}

                {!isResetRequest && !isResetConfirm && (
                    <>
                        <div className="relative py-7 z-10" aria-hidden="true">
                            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100" /></div>
                            <div className="relative flex justify-center"><span className="text-[10px] uppercase tracking-widest font-bold text-gray-400 bg-white px-4">{t('auth.oauth.divider')}</span></div>
                        </div>
                        <div className="space-y-3 z-10">
                            <button
                                type="button"
                                disabled={Boolean(socialLoading) || isLoading}
                                onClick={() => handleSocialLogin('google')}
                                className="w-full min-h-12 flex items-center justify-center gap-3 p-4 border-2 border-gray-100 rounded-2xl hover:bg-gray-50 hover:border-gray-200 transition-all font-bold text-sm text-gray-700 active:scale-[0.98] disabled:opacity-60"
                            >
                                {socialLoading === 'google' ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : <Chrome size={20} className="text-red-500" aria-hidden="true" />}
                                {socialLoading === 'google' ? t('auth.oauth.opening', { provider: t('auth.providers.google') }) : t('auth.oauth.continueWith', { provider: t('auth.providers.google') })}
                            </button>
                            <button
                                type="button"
                                disabled={Boolean(socialLoading) || isLoading}
                                onClick={() => handleSocialLogin('facebook')}
                                className="w-full min-h-12 flex items-center justify-center gap-3 p-4 bg-[#1877F2] text-white rounded-2xl hover:bg-[#166fe5] shadow-md shadow-[#1877F2]/20 transition-all font-bold text-sm active:scale-[0.98] disabled:opacity-60"
                            >
                                {socialLoading === 'facebook' ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : <Facebook size={20} fill="white" strokeWidth={0} aria-hidden="true" />}
                                {socialLoading === 'facebook' ? t('auth.oauth.opening', { provider: t('auth.providers.facebook') }) : t('auth.oauth.continueWith', { provider: t('auth.providers.facebook') })}
                            </button>
                        </div>
                    </>
                )}
            </div>

            <p className="mt-5 text-xs text-gray-500 font-medium text-center px-4">
                {t('auth.terms.prefix')} <a href="/privacy" className="text-gray-700 hover:text-gray-900 underline underline-offset-2">{t('auth.terms.privacy')}</a>.
            </p>
        </div>
    );
};
