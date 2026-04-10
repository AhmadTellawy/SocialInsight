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
        <div className="flex flex-col h-full bg-[#FAFAFA] font-sans">
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8 relative overflow-hidden">
                {/* Decorative blob */}
                <div className="absolute top-10 -right-20 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute bottom-10 -left-20 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

                <div className="w-28 h-28 mb-8 relative z-10 flex items-center justify-center bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-gray-100">
                    <img src="logo.png" alt="Logo" className="w-16 h-16 object-contain drop-shadow-sm" />
                </div>
                <h1 className="text-3xl sm:text-4xl font-black text-gray-900 mb-4 tracking-tight relative z-10">
                    Discover More.
                </h1>
                <p className="text-gray-500 font-medium leading-relaxed max-w-[280px] text-sm relative z-10">
                    Join Social Insight to participate in trending polls, debates, and connect with people who share your interests.
                </p>
            </div>

            <div className="px-6 pb-12 space-y-4 bg-white pt-8 rounded-t-[2.5rem] shadow-[0_-10px_40px_rgb(0,0,0,0.03)] border-t border-gray-100 relative z-20">
                <button
                    onClick={() => onNext({ action: 'create' })}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase tracking-[0.15em] text-xs shadow-[0_8px_20px_rgb(37,99,235,0.25)] hover:shadow-[0_8px_25px_rgb(37,99,235,0.35)] active:scale-[0.98] transition-all flex items-center justify-center relative overflow-hidden group"
                >
                    <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                    <span className="relative z-10">Create Account</span>
                </button>
                <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100"></div></div>
                    <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-bold text-gray-400 bg-white px-4">Already have an account?</div>
                </div>
                <button
                    onClick={onBack}
                    className="w-full bg-white text-gray-900 py-4 rounded-2xl font-black uppercase tracking-[0.15em] text-xs border-2 border-gray-100 hover:border-gray-200 hover:bg-gray-50 active:scale-[0.98] transition-all"
                >
                    Log In
                </button>
            </div>
        </div>
    );
};

export const BasicInfoStep: React.FC<StepProps> = ({ onNext, onBack, isLoading }) => {
    const [day, setDay] = useState('');
    const [month, setMonth] = useState('');
    const [year, setYear] = useState('');
    const [formData, setFormData] = useState({
        fullName: '',
        email: '',
        dob: ''
    });

    useEffect(() => {
        if (year && month && day) {
            setFormData(prev => ({ ...prev, dob: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` }));
        } else {
            setFormData(prev => ({ ...prev, dob: '' }));
        }
    }, [day, month, year]);

    const isValid = formData.fullName && formData.email && formData.dob;

    return (
        <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300">
            <div className="px-6 pt-6 pb-4 border-b border-gray-50">
                <button onClick={onBack} className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors mb-4">
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>
                <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">Create your account</h2>
                <p className="text-gray-500 text-sm font-medium mt-1">Please provide your details below.</p>
            </div>

            <div className="flex-1 px-6 pt-6 space-y-6 overflow-y-auto">
                <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider ml-1">Full Name</label>
                    <div className="relative group">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={20} />
                        <input
                            autoFocus
                            type="text"
                            value={formData.fullName}
                            onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                            className="w-full bg-gray-50 border border-gray-200 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 rounded-2xl pl-12 pr-4 py-4 outline-none transition-all font-medium text-gray-900 placeholder:text-gray-400"
                            placeholder="e.g. John Doe"
                        />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider ml-1">Email Address</label>
                    <div className="relative group">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={20} />
                        <input
                            type="email"
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            className="w-full bg-gray-50 border border-gray-200 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 rounded-2xl pl-12 pr-4 py-4 outline-none transition-all font-medium text-gray-900 placeholder:text-gray-400"
                            placeholder="you@example.com"
                        />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider ml-1">Date of Birth</label>
                    <div className="relative flex gap-2">
                        <select
                            value={day}
                            onChange={e => setDay(e.target.value)}
                            className="w-1/3 bg-gray-50 border border-gray-200 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 rounded-2xl px-4 py-4 outline-none transition-all font-medium text-gray-900 appearance-none"
                        >
                            <option value="" disabled>Day</option>
                            {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                                <option key={d} value={String(d)}>{d}</option>
                            ))}
                        </select>
                        <select
                            value={month}
                            onChange={e => setMonth(e.target.value)}
                            className="flex-1 bg-gray-50 border border-gray-200 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 rounded-2xl px-4 py-4 outline-none transition-all font-medium text-gray-900 appearance-none"
                        >
                            <option value="" disabled>Month</option>
                            {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => (
                                <option key={m} value={String(i + 1)}>{m}</option>
                            ))}
                        </select>
                        <select
                            value={year}
                            onChange={e => setYear(e.target.value)}
                            className="w-1/3 bg-gray-50 border border-gray-200 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 rounded-2xl px-4 py-4 outline-none transition-all font-medium text-gray-900 appearance-none"
                        >
                            <option value="" disabled>Year</option>
                            {Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - 13 - i).map(y => (
                                <option key={y} value={String(y)}>{y}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            <div className="p-6 bg-white border-t border-gray-50">
                <button
                    disabled={!isValid || isLoading}
                    onClick={() => onNext(formData)}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase tracking-[0.15em] text-xs shadow-[0_8px_20px_rgb(37,99,235,0.25)] hover:shadow-[0_8px_25px_rgb(37,99,235,0.35)] active:scale-[0.98] transition-all disabled:opacity-70 disabled:shadow-none flex items-center justify-center gap-2 group"
                >
                    {isLoading ? <Loader2 className="animate-spin" /> : <>Continue <ArrowRight size={18} strokeWidth={2.5} className="group-hover:translate-x-1 transition-transform" /></>}
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
    return (
        <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300">
            <div className="px-6 pt-6 pb-4 border-b border-gray-50">
                <button onClick={onBack} className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors mb-4">
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>
                <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">Create a password</h2>
                <p className="text-gray-500 text-sm font-medium mt-1">Make it strong and secure.</p>
            </div>

            <div className="flex-1 px-6 pt-6 space-y-6 overflow-y-auto">
                <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={20} />
                    <input
                        autoFocus
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 rounded-2xl pl-12 pr-12 py-4 outline-none transition-all font-medium text-gray-900"
                        placeholder="Your password"
                    />
                    <button
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                </div>

                <div className="bg-gray-50 rounded-2xl p-5 space-y-4 border border-gray-100">
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Password Requirements</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {rules.map(rule => (
                            <div key={rule.id} className="flex items-center gap-3">
                                <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300 ${rule.valid ? 'bg-green-500 shadow-[0_0_10px_rgb(34,197,94,0.3)]' : 'bg-gray-200'}`}>
                                    {rule.valid ? <Check size={12} strokeWidth={4} className="text-white" /> : <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />}
                                </div>
                                <span className={`text-sm font-medium transition-colors ${rule.valid ? 'text-gray-900' : 'text-gray-500'}`}>{rule.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="p-6 bg-white border-t border-gray-50">
                <button
                    disabled={!isValid || isLoading}
                    onClick={() => onNext({ password })}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase tracking-[0.15em] text-xs shadow-[0_8px_20px_rgb(37,99,235,0.25)] hover:shadow-[0_8px_25px_rgb(37,99,235,0.35)] active:scale-[0.98] transition-all disabled:opacity-70 disabled:shadow-none flex items-center justify-center gap-2 group"
                >
                    {isLoading ? <Loader2 className="animate-spin" /> : <>Continue <ArrowRight size={18} strokeWidth={2.5} className="group-hover:translate-x-1 transition-transform" /></>}
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
    return (
        <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300">
            <div className="px-6 pt-6 pb-4 border-b border-gray-50">
                <button onClick={onBack} className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors mb-4">
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>
                <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">Choose a handle</h2>
                <p className="text-gray-500 text-sm font-medium mt-1">This is how people will find you.</p>
            </div>

            <div className="flex-1 px-6 pt-6 space-y-6">
                <div className="relative group">
                    <AtSign className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${isAvailable === true ? 'text-green-500' : 'text-gray-400 group-focus-within:text-blue-500'}`} size={20} />
                    <input
                        autoFocus
                        type="text"
                        value={handle}
                        onChange={e => {
                            const val = e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '');
                            setHandle(val);
                        }}
                        className={`w-full bg-gray-50 border focus:bg-white focus:ring-4 rounded-2xl pl-12 pr-12 py-4 outline-none transition-all font-medium text-gray-900 placeholder:text-gray-400 ${isAvailable === true ? 'border-green-500 focus:border-green-500 focus:ring-green-500/10' : isAvailable === false ? 'border-red-500 focus:border-red-500 focus:ring-red-500/10' : 'border-gray-200 focus:border-blue-500 focus:ring-blue-500/10'}`}
                        placeholder="e.g. johndoe"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        {isChecking ? <Loader2 className="animate-spin text-blue-500" size={20} /> :
                            isAvailable === true ? <Check className="text-green-500" size={20} strokeWidth={3} /> :
                                isAvailable === false ? <X className="text-red-500" size={20} strokeWidth={3} /> : null}
                    </div>
                </div>
                {isAvailable === false && !isChecking && (
                    <p className="text-sm text-red-500 font-medium px-1 flex items-center gap-1"><X size={14} /> That handle is taken, try another one.</p>
                )}
                {isAvailable === true && !isChecking && (
                    <p className="text-sm text-green-600 font-medium px-1 flex items-center gap-1"><Check size={14} /> @{handle} is available!</p>
                )}
                {isAvailable === null && !isChecking && handle.length > 0 && handle.length < 3 && (
                    <p className="text-sm text-gray-500 font-medium px-1">Must be at least 3 characters.</p>
                )}
            </div>

            <div className="p-6 bg-white border-t border-gray-50">
                <button
                    disabled={!isValid || isExternalLoading}
                    onClick={() => onNext({ handle })}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase tracking-[0.15em] text-xs shadow-[0_8px_20px_rgb(37,99,235,0.25)] hover:shadow-[0_8px_25px_rgb(37,99,235,0.35)] active:scale-[0.98] transition-all disabled:opacity-70 disabled:shadow-none flex items-center justify-center gap-2 group"
                >
                    {isExternalLoading ? <Loader2 className="animate-spin" /> : <>Complete Sign Up <Check size={18} strokeWidth={3} /></>}
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
    return (
        <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300">
            <div className="px-6 pt-12 pb-4 text-center">
                <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Mail size={32} strokeWidth={1.5} />
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight mb-2">Check your mail</h2>
                <p className="text-gray-500 text-sm font-medium">We sent a verification code to <br/><span className="text-gray-900 font-bold">{data.email}</span></p>
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
                            className="w-11 sm:w-12 h-14 bg-gray-50 border border-gray-200 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 rounded-xl text-center text-xl font-black text-gray-900 outline-none transition-all"
                        />
                    ))}
                </div>

                <div className="mt-10">
                    <button disabled={timer > 0} onClick={() => setTimer(60)} className="flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-700 disabled:text-gray-400 transition-colors">
                        <RefreshCw size={14} className={timer > 0 ? "animate-spin" : ""} />
                        {timer > 0 ? `Resend code in ${timer}s` : "Resend Code"}
                    </button>
                </div>
            </div>

            <div className="p-6 bg-white border-t border-gray-50">
                <button
                    disabled={!isValid || isLoading}
                    onClick={() => onNext({ code: otp.join('') })}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase tracking-[0.15em] text-xs shadow-[0_8px_20px_rgb(37,99,235,0.25)] hover:shadow-[0_8px_25px_rgb(37,99,235,0.35)] active:scale-[0.98] transition-all disabled:opacity-70 disabled:shadow-none flex items-center justify-center gap-2 group"
                >
                    {isLoading ? <Loader2 className="animate-spin" /> : <>Verify <ArrowRight size={18} strokeWidth={2.5} className="group-hover:translate-x-1 transition-transform" /></>}
                </button>
            </div>
        </div>
    );
};

export const NotificationStep: React.FC<StepProps> = ({ onNext, isLoading }) => {
    return (
    return (
        <div className="flex flex-col h-full bg-[#FAFAFA] animate-in zoom-in-95 duration-500 items-center justify-center text-center p-6 relative overflow-hidden">
            {/* Background blobs for premium feel */}
            <div className="absolute top-1/4 -right-20 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-1/4 -left-20 w-64 h-64 bg-green-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="w-28 h-28 bg-white rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-gray-100 flex items-center justify-center mb-10 relative z-10">
                <div className="absolute inset-0 bg-blue-100 rounded-full animate-ping opacity-30"></div>
                <Bell size={40} className="text-blue-600 relative z-10 drop-shadow-sm" />
                <div className="absolute top-2 right-2 w-6 h-6 bg-red-500 rounded-full border-4 border-white z-20"></div>
            </div>

            <h2 className="text-3xl font-black text-gray-900 tracking-tight mb-4 relative z-10">Stay connected</h2>
            <p className="text-gray-500 font-medium leading-relaxed max-w-[280px] text-sm relative z-10 mb-12">
                Enable notifications to instantly know when friends reply or when topics you care about are trending.
            </p>

            <div className="space-y-4 w-full max-w-sm relative z-20">
                <button
                    onClick={() => onNext({ notifications: true })}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase tracking-[0.15em] text-xs shadow-[0_8px_20px_rgb(37,99,235,0.25)] hover:shadow-[0_8px_25px_rgb(37,99,235,0.35)] active:scale-[0.98] transition-all flex items-center justify-center gap-2 group"
                >
                    <Bell size={16} className="group-hover:rotate-12 transition-transform" /> <span className="pt-0.5">Turn on Notifications</span>
                </button>
                <button
                    onClick={() => onNext({ notifications: false })}
                    className="w-full bg-transparent border-2 border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700 py-4 rounded-2xl font-black uppercase tracking-[0.15em] text-xs active:scale-[0.98] transition-all"
                >
                    Not right now
                </button>
            </div>
        </div>
    );
};
