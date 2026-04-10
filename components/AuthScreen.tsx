import React, { useState } from 'react';
import { Mail, Phone, Lock, ArrowRight, Chrome, Facebook, ArrowLeft, Loader2, LogIn, AlertCircle } from 'lucide-react';
import { api } from '../services/api';
import { PhoneInput } from './PhoneInput';
import { OTPVerificationModal } from './OTPVerificationModal';
import { SignUpFlow } from './SignUpFlow';

interface AuthScreenProps {
    onAuthSuccess: (user: any) => void;
    initialViewMode?: 'flow' | 'login';
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess, initialViewMode = 'flow' }) => {
    // viewMode: 'flow' (SignUpFlow covering Welcome+Register) or 'login' (Legacy Login)
    const [viewMode, setViewMode] = useState<'flow' | 'login'>(initialViewMode);

    // Legacy Login State
    const [authMethod, setAuthMethod] = useState<'email' | 'phone' | 'social' | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Login Form Data
    const [formData, setFormData] = useState({
        identifier: '',
        password: ''
    });

    // We can reuse the Welcome Screen from SignUpFlow as the entry point
    // If user clicks "Log In" in SignUpFlow, it calls onCancel -> we switch to 'login'

    const handleLoginSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            const user = await api.login({
                identifier: formData.identifier,
                password: formData.password,
                authProvider: 'Email' // Simplified for demo
            });
            onAuthSuccess(user);
        } catch (err: any) {
            setError(err.message || 'Login failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSocialLogin = (provider: string) => {
        // ... existing social logic ...
        alert("Social login coming soon");
    };

    if (viewMode === 'flow') {
        return (
            <SignUpFlow
                onComplete={onAuthSuccess}
                onCancel={() => setViewMode('login')}
            />
        );
    }

    // Login View
    return (
        <div className="min-h-screen bg-[#FAFAFA] flex flex-col items-center justify-center p-6 animate-in fade-in duration-700 font-sans">
            <div className="w-full max-w-md bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:shadow-[0_20px_40px_rgb(0,0,0,0.08)] p-8 sm:p-10 border border-gray-100 flex flex-col relative overflow-hidden">
                {/* Decorative blob */}
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

                <button
                    onClick={() => setViewMode('flow')}
                    className="flex items-center gap-2 text-gray-400 hover:text-gray-900 mb-8 transition-colors self-start z-10"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                    <span className="text-xs font-bold uppercase tracking-[0.2em]">Back</span>
                </button>

                <div className="mb-10 text-center z-10">
                    <h2 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight mb-3">
                        Welcome Back
                    </h2>
                    <p className="text-gray-500 text-sm font-medium">
                        Log in to interact, share, and stay connected with the community.
                    </p>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50/80 border border-red-100 rounded-2xl text-red-600 text-sm font-bold flex items-center gap-3 z-10 backdrop-blur-sm animate-in slide-in-from-top-2">
                        <AlertCircle size={18} className="shrink-0" />
                        <p>{error}</p>
                    </div>
                )}

                <form onSubmit={handleLoginSubmit} className="space-y-5 z-10">
                    <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider pl-1">Email or Username</label>
                        <div className="relative group">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={20} />
                            <input
                                required
                                type="text"
                                value={formData.identifier}
                                onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
                                placeholder="Enter your email or handle"
                                className="w-full bg-gray-50 border border-gray-200 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 rounded-2xl pl-12 pr-4 py-4 outline-none transition-all font-medium text-gray-900 placeholder:text-gray-400"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider pl-1">Password</label>
                        <div className="relative group">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={20} />
                            <input
                                required
                                type="password"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                placeholder="Enter your password"
                                className="w-full bg-gray-50 border border-gray-200 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 rounded-2xl pl-12 pr-4 py-4 outline-none transition-all font-medium text-gray-900 placeholder:text-gray-400"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end pt-1">
                        <button type="button" className="text-sm font-bold text-blue-600 hover:text-blue-700 transition-colors hover:underline decoration-blue-600/30 underline-offset-4">
                            Forgot your password?
                        </button>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase tracking-[0.15em] text-xs shadow-[0_8px_20px_rgb(37,99,235,0.25)] hover:shadow-[0_8px_25px_rgb(37,99,235,0.35)] mt-4 active:scale-[0.98] transition-all disabled:opacity-70 disabled:pointer-events-none flex items-center justify-center gap-3 relative overflow-hidden group"
                    >
                        <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                        <span className="relative z-10 flex items-center gap-2">
                           {isLoading ? <Loader2 className="animate-spin" size={18} /> : <><LogIn size={18} strokeWidth={2.5} /> Sign In</>}
                        </span>
                    </button>
                </form>

                <div className="relative py-8 z-10">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100"></div></div>
                    <div className="relative flex justify-center">
                        <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400 bg-white px-4">Or continue with</span>
                    </div>
                </div>

                <div className="space-y-3 z-10">
                    <button
                        type="button"
                        onClick={() => handleSocialLogin('Google')}
                        className="w-full flex items-center justify-center gap-3 p-4 border-2 border-gray-100 rounded-2xl hover:bg-gray-50 hover:border-gray-200 transition-all font-bold text-sm text-gray-700 active:scale-[0.98]"
                    >
                        <Chrome size={20} className="text-red-500" />
                        Continue with Google
                    </button>
                    <button
                        type="button"
                        onClick={() => handleSocialLogin('Facebook')}
                        className="w-full flex items-center justify-center gap-3 p-4 bg-[#1877F2] text-white rounded-2xl hover:bg-[#166fe5] shadow-md shadow-[#1877F2]/20 transition-all font-bold text-sm active:scale-[0.98]"
                    >
                        <Facebook size={20} fill="white" strokeWidth={0} />
                        Continue with Facebook
                    </button>
                </div>
            </div>
            
            <p className="mt-8 text-xs text-gray-400 font-medium">
                By logging in, you agree to our <a href="#" className="text-gray-600 hover:text-gray-900 underline underline-offset-2">Terms of Service</a> and <a href="#" className="text-gray-600 hover:text-gray-900 underline underline-offset-2">Privacy Policy</a>.
            </p>
        </div>
    );
};
