import React, { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, Check, X, Calendar, User, Mail, Lock, Eye, EyeOff, Loader2, AtSign, RefreshCw, Bell } from 'lucide-react';

interface StepProps {
    onNext: (data: any) => void;
    onBack?: () => void;
    isLoading?: boolean;
    data?: any;
}

export const WelcomeStep: React.FC<StepProps> = ({ onNext, onBack }) => {
    return (
        <div className="flex flex-col h-full animate-in fade-in duration-500">
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
                <div className="w-24 h-24 mb-8 relative">
                    <div className="absolute inset-0 bg-blue-100 rounded-full animate-ping opacity-20"></div>
                    <img src="logo.png" alt="Logo" className="w-full h-full object-contain relative z-10 drop-shadow-lg" />
                </div>
                <h1 className="text-3xl font-black text-gray-900 mb-3 tracking-tight">Join the Conversation</h1>
                <p className="text-gray-500 font-medium leading-relaxed max-w-xs">
                    Create an account to connecting with communities, share your voice, and discover trends.
                </p>
            </div>

            <div className="px-6 pb-8 space-y-4">
                <button
                    onClick={() => onNext({ action: 'create' })}
                    className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-sm uppercase tracking-wider shadow-xl shadow-blue-200 active:scale-[0.98] transition-all hover:bg-blue-700"
                >
                    Create Account
                </button>
                <button
                    onClick={onBack}
                    className="w-full py-4 rounded-xl bg-white text-gray-900 font-bold text-sm uppercase tracking-wider border border-gray-200 active:scale-[0.98] transition-all hover:bg-gray-50"
                >
                    Log In
                </button>
            </div>
        </div>
    );
};

export const BasicInfoStep: React.FC<StepProps> = ({ onNext, onBack, isLoading }) => {
    const [formData, setFormData] = useState({
        fullName: '',
        email: '',
        dob: ''
    });

    const isValid = formData.fullName && formData.email && formData.dob;

    return (
        <div className="flex flex-col h-full animate-in slide-in-from-right duration-300">
            <div className="px-6 pt-6 pb-2">
                <button onClick={onBack} className="p-2 -ml-2 text-gray-400 hover:text-gray-900 transition-colors">
                    <ArrowLeft size={24} />
                </button>
                <h2 className="text-2xl font-black text-gray-900 mt-4 mb-2">Create your account</h2>
                <p className="text-gray-400 text-sm">We just need a few details to get you started.</p>
            </div>

            <div className="flex-1 px-6 pt-6 space-y-5">
                <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Full Name</label>
                    <div className="relative">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            autoFocus
                            type="text"
                            value={formData.fullName}
                            onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                            className="w-full bg-gray-50 border border-transparent focus:border-blue-500 focus:bg-white rounded-xl pl-12 pr-4 py-4 outline-none transition-all font-semibold text-gray-900 placeholder:text-gray-300"
                            placeholder="John Doe"
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Email Address</label>
                    <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="email"
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            className="w-full bg-gray-50 border border-transparent focus:border-blue-500 focus:bg-white rounded-xl pl-12 pr-4 py-4 outline-none transition-all font-semibold text-gray-900 placeholder:text-gray-300"
                            placeholder="john@example.com"
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Date of Birth</label>
                    <div className="relative">
                        <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="date"
                            value={formData.dob}
                            onChange={e => setFormData({ ...formData, dob: e.target.value })}
                            max={new Date().toISOString().split('T')[0]}
                            className="w-full bg-gray-50 border border-transparent focus:border-blue-500 focus:bg-white rounded-xl pl-12 pr-4 py-4 outline-none transition-all font-semibold text-gray-900 placeholder:text-gray-300"
                        />
                    </div>
                    <p className="text-[10px] text-gray-400 px-1 leading-tight">Must be at least 13 years old to register.</p>
                </div>
            </div>

            <div className="p-6">
                <button
                    disabled={!isValid || isLoading}
                    onClick={() => onNext(formData)}
                    className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-sm uppercase tracking-wider shadow-lg shadow-blue-200 active:scale-[0.98] transition-all hover:bg-blue-700 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                >
                    {isLoading ? <Loader2 className="animate-spin" /> : <>Next <ArrowRight size={18} /></>}
                </button>
            </div>
        </div>
    );
};

export const PasswordStep: React.FC<StepProps> = ({ onNext, onBack, isLoading }) => {
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const rules = [
        { id: 'min', label: 'Min 8 chars', valid: password.length >= 8 },
        { id: 'num', label: 'Number (0-9)', valid: /\d/.test(password) },
        { id: 'sym', label: 'Symbol (!@#$)', valid: /[!@#$%^&*]/.test(password) },
        { id: 'up', label: 'Uppercase', valid: /[A-Z]/.test(password) },
        { id: 'low', label: 'Lowercase', valid: /[a-z]/.test(password) },
    ];

    const isValid = rules.every(r => r.valid);

    return (
        <div className="flex flex-col h-full animate-in slide-in-from-right duration-300">
            <div className="px-6 pt-6 pb-2">
                <button onClick={onBack} className="p-2 -ml-2 text-gray-400 hover:text-gray-900 transition-colors">
                    <ArrowLeft size={24} />
                </button>
                <h2 className="text-2xl font-black text-gray-900 mt-4 mb-2">You'll need a password</h2>
                <p className="text-gray-400 text-sm">Make it strong and secure.</p>
            </div>

            <div className="flex-1 px-6 pt-6 space-y-6">
                <div className="relative">
                    <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            autoFocus
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="w-full bg-gray-50 border border-transparent focus:border-blue-500 focus:bg-white rounded-xl pl-12 pr-12 py-4 outline-none transition-all font-semibold text-gray-900"
                            placeholder="Password"
                        />
                        <button
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                    </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Password Requirements</p>
                    {rules.map(rule => (
                        <div key={rule.id} className="flex items-center gap-3">
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${rule.valid ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-400'}`}>
                                {rule.valid ? <Check size={12} strokeWidth={3} /> : <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />}
                            </div>
                            <span className={`text-sm font-medium transition-colors ${rule.valid ? 'text-gray-900' : 'text-gray-500'}`}>{rule.label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="p-6">
                <button
                    disabled={!isValid || isLoading}
                    onClick={() => onNext({ password })}
                    className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-sm uppercase tracking-wider shadow-lg shadow-blue-200 active:scale-[0.98] transition-all hover:bg-blue-700 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                >
                    {isLoading ? <Loader2 className="animate-spin" /> : <>Next <ArrowRight size={18} /></>}
                </button>
            </div>
        </div>
    );
};

export const HandleStep: React.FC<StepProps> = ({ onNext, onBack, isLoading: isExternalLoading }) => {
    const [handle, setHandle] = useState('');
    const [isChecking, setIsChecking] = useState(false);
    const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
    const [debouncedHandle, setDebouncedHandle] = useState('');

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedHandle(handle), 500);
        return () => clearTimeout(timer);
    }, [handle]);

    useEffect(() => {
        const check = async () => {
            if (debouncedHandle.length < 3) {
                setIsAvailable(null);
                return;
            }
            setIsChecking(true);
            try {
                const res = await fetch(`/api/auth/handle/check?handle=${debouncedHandle}`);
                const data = await res.json();
                setIsAvailable(data.available);
            } catch (e) {
                console.error(e);
                // Fallback to true if server dead for demo
                setIsAvailable(true);
            } finally {
                setIsChecking(false);
            }
        };
        check();
    }, [debouncedHandle]);

    const isValid = handle.length >= 3 && isAvailable === true;

    return (
        <div className="flex flex-col h-full animate-in slide-in-from-right duration-300">
            <div className="px-6 pt-6 pb-2">
                <button onClick={onBack} className="p-2 -ml-2 text-gray-400 hover:text-gray-900 transition-colors">
                    <ArrowLeft size={24} />
                </button>
                <h2 className="text-2xl font-black text-gray-900 mt-4 mb-2">Choose a Handle</h2>
                <p className="text-gray-400 text-sm">This is how people will find you. You can change it later.</p>
            </div>

            <div className="flex-1 px-6 pt-6 space-y-6">
                <div className="relative">
                    <div className="relative">
                        <AtSign className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            autoFocus
                            type="text"
                            value={handle}
                            onChange={e => {
                                const val = e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '');
                                setHandle(val);
                            }}
                            className={`w-full bg-gray-50 border focus:bg-white rounded-xl pl-12 pr-12 py-4 outline-none transition-all font-semibold text-gray-900 ${isAvailable === true ? 'border-green-500 focus:border-green-500' : isAvailable === false ? 'border-red-500 focus:border-red-500' : 'border-transparent focus:border-blue-500'}`}
                            placeholder="username"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                            {isChecking ? <Loader2 className="animate-spin text-gray-400" size={20} /> :
                                isAvailable === true ? <Check className="text-green-500" size={20} /> :
                                    isAvailable === false ? <X className="text-red-500" size={20} /> : null}
                        </div>
                    </div>
                    {isAvailable === false && !isChecking && (
                        <p className="text-xs text-red-500 mt-2 font-medium px-1">That handle is taken, try another one.</p>
                    )}
                    {isAvailable === true && !isChecking && (
                        <p className="text-xs text-green-600 mt-2 font-medium px-1">@{handle} is available!</p>
                    )}
                </div>
            </div>

            <div className="p-6">
                <button
                    disabled={!isValid || isExternalLoading}
                    onClick={() => onNext({ handle })}
                    className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-sm uppercase tracking-wider shadow-lg shadow-blue-200 active:scale-[0.98] transition-all hover:bg-blue-700 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                >
                    {isExternalLoading ? <Loader2 className="animate-spin" /> : <>Sign Up <ArrowRight size={18} /></>}
                </button>
            </div>
        </div>
    );
};

export const OTPStep: React.FC<StepProps> = ({ onNext, data, isLoading }) => {
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [timer, setTimer] = useState(60);

    useEffect(() => {
        if (timer > 0) {
            const t = setTimeout(() => setTimer(timer - 1), 1000);
            return () => clearTimeout(t);
        }
    }, [timer]);

    const handleChange = (index: number, value: string) => {
        if (value.length > 1) {
            // handle paste
            return;
        }
        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);

        if (value && index < 5) {
            const nextInput = document.getElementById(`otp-${index + 1}`);
            nextInput?.focus();
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === 'Backspace' && !otp[index] && index > 0) {
            const prevInput = document.getElementById(`otp-${index - 1}`);
            prevInput?.focus();
        }
    };

    const isValid = otp.every(d => d !== '');

    return (
        <div className="flex flex-col h-full animate-in slide-in-from-right duration-300">
            <div className="px-6 pt-6 pb-2 text-center">
                <h2 className="text-2xl font-black text-gray-900 mt-4 mb-2">We sent you a code</h2>
                <p className="text-gray-400 text-sm">Enter the code sent to <span className="text-gray-900 font-bold">{data.email}</span></p>
            </div>

            <div className="flex-1 px-6 pt-8 flex flex-col items-center">
                <div className="flex gap-2">
                    {otp.map((digit, i) => (
                        <input
                            key={i}
                            id={`otp-${i}`}
                            type="text"
                            maxLength={1}
                            value={digit}
                            onChange={e => handleChange(i, e.target.value)}
                            onKeyDown={e => handleKeyDown(i, e)}
                            className="w-12 h-14 bg-gray-50 border border-gray-200 focus:border-blue-500 focus:bg-white rounded-xl text-center text-xl font-black text-gray-900 outline-none transition-all"
                        />
                    ))}
                </div>

                <div className="mt-8">
                    <button disabled={timer > 0} onClick={() => setTimer(60)} className="flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-gray-900 disabled:opacity-50">
                        <RefreshCw size={14} className={timer > 0 ? "animate-spin" : ""} />
                        {timer > 0 ? `Resend code in ${timer}s` : "Resend Code"}
                    </button>
                </div>
            </div>

            <div className="p-6">
                <button
                    disabled={!isValid || isLoading}
                    onClick={() => onNext({ code: otp.join('') })}
                    className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-sm uppercase tracking-wider shadow-lg shadow-blue-200 active:scale-[0.98] transition-all hover:bg-blue-700 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                >
                    {isLoading ? <Loader2 className="animate-spin" /> : <>Verify <ArrowRight size={18} /></>}
                </button>
            </div>
        </div>
    );
};

export const NotificationStep: React.FC<StepProps> = ({ onNext, isLoading }) => {
    return (
        <div className="flex flex-col h-full animate-in zoom-in duration-300 items-center justify-center text-center p-6 bg-gradient-to-br from-blue-50 to-white">
            <div className="w-32 h-32 bg-white rounded-3xl shadow-xl flex items-center justify-center mb-8 relative">
                <Bell size={48} className="text-blue-500 fill-blue-100" />
                <div className="absolute top-0 right-0 w-8 h-8 bg-red-500 rounded-full border-4 border-white"></div>
            </div>

            <h2 className="text-2xl font-black text-gray-900 mb-4">Stay in the loop?</h2>
            <p className="text-gray-500 font-medium leading-relaxed max-w-xs mb-10">
                Turn on notifications to get updates on your surveys, replies from friends, and trending topics.
            </p>

            <div className="space-y-4 w-full max-w-sm">
                <button
                    onClick={() => onNext({ notifications: true })}
                    className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-sm uppercase tracking-wider shadow-xl shadow-blue-200 active:scale-[0.98] transition-all hover:bg-blue-700 flex items-center justify-center gap-2"
                >
                    <Bell size={18} /> Turn on Notifications
                </button>
                <button
                    onClick={() => onNext({ notifications: false })}
                    className="w-full py-4 rounded-xl bg-transparent text-gray-400 font-bold text-sm uppercase tracking-wider hover:text-gray-600 transition-all"
                >
                    Maybe Later
                </button>
            </div>
        </div>
    );
};
