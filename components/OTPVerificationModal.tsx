import React, { useState, useEffect } from 'react';
import { Check, X, Mail, Phone } from 'lucide-react';

interface OTPVerificationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onVerify: (code: string) => Promise<boolean>;
    identifier: string; // email or phone
    type: 'email' | 'phone';
    onResend: () => void;
}

export const OTPVerificationModal: React.FC<OTPVerificationModalProps> = ({
    isOpen,
    onClose,
    onVerify,
    identifier,
    type,
    onResend
}) => {
    const [code, setCode] = useState(['', '', '', '', '', '']);
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [canResend, setCanResend] = useState(false);
    const [resendTimer, setResendTimer] = useState(60);

    useEffect(() => {
        if (isOpen && resendTimer > 0) {
            const timer = setTimeout(() => setResendTimer(prev => prev - 1), 1000);
            return () => clearTimeout(timer);
        } else if (resendTimer === 0) {
            setCanResend(true);
        }
    }, [isOpen, resendTimer]);

    const handleChange = (index: number, value: string) => {
        if (!/^\d*$/.test(value)) return;

        const newCode = [...code];
        newCode[index] = value.slice(-1);
        setCode(newCode);
        setError(null);

        // Auto-focus next input
        if (value && index < 5) {
            const nextInput = document.getElementById(`otp-${index + 1}`);
            nextInput?.focus();
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === 'Backspace' && !code[index] && index > 0) {
            const prevInput = document.getElementById(`otp-${index - 1}`);
            prevInput?.focus();
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').slice(0, 6);
        if (!/^\d+$/.test(pastedData)) return;

        const newCode = [...code];
        pastedData.split('').forEach((char, i) => {
            if (i < 6) newCode[i] = char;
        });
        setCode(newCode);

        // Focus last filled input
        const lastIndex = Math.min(pastedData.length - 1, 5);
        document.getElementById(`otp-${lastIndex}`)?.focus();
    };

    const handleVerify = async () => {
        const fullCode = code.join('');
        if (fullCode.length !== 6) {
            setError('Please enter all 6 digits');
            return;
        }

        setIsVerifying(true);
        setError(null);

        try {
            const success = await onVerify(fullCode);
            if (!success) {
                setError('Invalid code. Please try again.');
                setCode(['', '', '', '', '', '']);
                document.getElementById('otp-0')?.focus();
            }
        } catch (err) {
            setError('Verification failed. Please try again.');
            setCode(['', '', '', '', '', '']);
        } finally {
            setIsVerifying(false);
        }
    };

    const handleResend = () => {
        onResend();
        setCanResend(false);
        setResendTimer(60);
        setCode(['', '', '', '', '', '']);
        setError(null);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
            <div className="bg-white rounded-[2.5rem] p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h2 className="text-2xl font-black text-gray-900 mb-2">Verify Your {type === 'email' ? 'Email' : 'Phone'}</h2>
                        <p className="text-sm text-gray-500">
                            We sent a code to <span className="font-bold text-gray-900">{identifier}</span>
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <X size={20} className="text-gray-400" />
                    </button>
                </div>

                {/* OTP Input */}
                <div className="space-y-6">
                    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
                        {code.map((digit, index) => (
                            <input
                                key={index}
                                id={`otp-${index}`}
                                type="text"
                                inputMode="numeric"
                                maxLength={1}
                                value={digit}
                                onChange={(e) => handleChange(index, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(index, e)}
                                className="w-12 h-14 text-center text-2xl font-black border-2 border-gray-200 rounded-xl focus:border-blue-600 focus:outline-none transition-all"
                                autoFocus={index === 0}
                            />
                        ))}
                    </div>

                    {error && (
                        <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm font-bold text-center animate-shake">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleVerify}
                        disabled={isVerifying || code.some(d => !d)}
                        className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        {isVerifying ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Verifying...
                            </>
                        ) : (
                            <>
                                <Check size={16} />
                                Verify Code
                            </>
                        )}
                    </button>

                    <div className="text-center">
                        {canResend ? (
                            <button
                                onClick={handleResend}
                                className="text-sm font-bold text-blue-600 hover:underline"
                            >
                                Resend Code
                            </button>
                        ) : (
                            <p className="text-sm text-gray-500">
                                Resend code in <span className="font-bold text-gray-900">{resendTimer}s</span>
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
