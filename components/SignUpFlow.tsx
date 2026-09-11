import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WelcomeStep, BasicInfoStep, PasswordStep, HandleStep, OTPStep, NotificationStep } from './SignUpSteps';
import { api, ApiError } from '../services/api';

interface SignUpFlowProps {
    onComplete: (user: any) => void;
    onCancel: () => void;
}

export const SignUpFlow: React.FC<SignUpFlowProps> = ({ onComplete, onCancel }) => {
    const { t } = useTranslation();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [collectedData, setCollectedData] = useState<any>({});
    const [error, setError] = useState<string | null>(null);

    const handleNext = async (stepData: any) => {
        setLoading(true);
        setError(null);
        try {
            if (step === 1) {
                if (stepData.action === 'create') {
                    setStep(2);
                } else {
                    onCancel();
                }
            } else if (step === 2) {
                const res = await api.initRegistration(stepData);
                setPendingId(res.pendingId || res.id);
                setCollectedData({ ...collectedData, ...stepData });
                setStep(3);
            } else if (step === 3) {
                if (pendingId) {
                    await api.setRegistrationPassword(pendingId, stepData.password);
                    setStep(4);
                }
            } else if (step === 4) {
                if (pendingId) {
                    await api.reserveHandle(pendingId, stepData.handle);
                    setCollectedData({ ...collectedData, ...stepData });

                    const otpResponse = await api.sendRegistrationOTP(pendingId);
                    setCollectedData((current: any) => ({
                        ...current,
                        ...stepData,
                        resendCooldownUntil: otpResponse?.cooldownUntil
                    }));
                    setStep(5);
                }
            } else if (step === 5) {
                if (pendingId) {
                    const res = await api.completeRegistration(pendingId, stepData.code);
                    setCollectedData({ ...collectedData, user: res.user });
                    if ('Notification' in window && Notification.permission !== 'default') {
                        onComplete(res.user);
                    } else {
                        setStep(6);
                    }
                }
            } else if (step === 6) {
                onComplete(collectedData.user);
            }
        } catch (err: any) {
            console.error(err);
            const code = err instanceof ApiError ? err.code : undefined;
            setError(code && ['OTP_COOLDOWN', 'REQUEST_TIMEOUT', 'NETWORK_ERROR'].includes(code)
                ? t(`auth.errors.${code}`)
                : t('auth.signup.genericError'));
        } finally {
            setLoading(false);
        }
    };

    const handleResendRegistrationOTP = async () => {
        if (!pendingId) throw new Error(t('auth.signup.sessionUnavailable'));
        return api.sendRegistrationOTP(pendingId);
    };

    const handleBack = () => {
        if (step === 2) {
            setStep(1);
        } else if (step > 1) {
            setStep(step - 1);
        } else {
            onCancel();
        }
    };

    const renderStep = () => {
        switch (step) {
            case 1: return <WelcomeStep onNext={handleNext} onBack={onCancel} />;
            case 2: return <BasicInfoStep onNext={handleNext} onBack={handleBack} isLoading={loading} />;
            case 3: return <PasswordStep onNext={handleNext} onBack={handleBack} isLoading={loading} />;
            case 4: return <HandleStep onNext={handleNext} onBack={handleBack} isLoading={loading} />;
            case 5: return <OTPStep onNext={handleNext} onResend={handleResendRegistrationOTP} data={collectedData} isLoading={loading} />;
            case 6: return <NotificationStep onNext={handleNext} isLoading={loading} />;
            default: return null;
        }
    };

    return (
        <div className="w-full h-full bg-white relative">
            {error && (
                <div role="alert" className="absolute top-0 left-0 right-0 p-4 bg-red-50 text-red-700 text-sm font-bold text-center z-50">
                    {error}
                    <button type="button" aria-label={t('auth.signup.dismiss')} onClick={() => setError(null)} className="ms-2 underline">{t('auth.signup.dismiss')}</button>
                </div>
            )}
            {renderStep()}
        </div>
    );
};
