import React, { useState } from 'react';
import { Mail, Phone, Lock, ArrowRight, Chrome, Facebook, ArrowLeft, Loader2, LogIn } from 'lucide-react';
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
        <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 animate-in slide-in-from-right duration-500">
            <div className="w-full max-w-sm">
                <button
                    onClick={() => setViewMode('flow')}
                    className="flex items-center gap-2 text-gray-400 hover:text-gray-600 mb-6 transition-colors"
                >
                    <ArrowLeft size={18} />
                    <span className="text-sm font-bold uppercase tracking-widest">Back</span>
                </button>

                <div className="mb-8">
                    <h2 className="text-2xl font-black text-gray-900">Welcome Back</h2>
                    <p className="text-gray-500 text-sm">Sign in to continue</p>
                </div>

                {error && (
                    <div className="mb-4 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm font-bold">
                        {error}
                    </div>
                )}

                <form onSubmit={handleLoginSubmit} className="space-y-4">
                    <div className="relative">
                        <Mail className="absolute left-4 top-4 text-gray-400" size={20} />
                        <input
                            required
                            type="text"
                            value={formData.identifier}
                            onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
                            placeholder="Email, Phone or Handle"
                            className="w-full bg-gray-50 border border-transparent focus:border-blue-500 focus:bg-white rounded-2xl pl-12 pr-4 py-4 outline-none transition-all font-medium"
                        />
                    </div>

                    <div className="relative">
                        <Lock className="absolute left-4 top-4 text-gray-400" size={20} />
                        <input
                            required
                            type="password"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            placeholder="Password"
                            className="w-full bg-gray-50 border border-transparent focus:border-blue-500 focus:bg-white rounded-2xl pl-12 pr-4 py-4 outline-none transition-all font-medium"
                        />
                    </div>

                    <div className="flex justify-end">
                        <button type="button" className="text-sm font-bold text-blue-600 hover:underline">Forgot password?</button>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-blue-200 mt-2 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
                    >
                        {isLoading ? <Loader2 className="animate-spin" /> : <><LogIn size={18} /> Sign In</>}
                    </button>
                </form>

                <div className="relative py-8">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100"></div></div>
                    <div className="relative flex justify-center text-xs uppercase tracking-widest font-black text-gray-300 bg-white px-4">Or continue with</div>
                </div>

                <div className="space-y-3">
                    <button
                        type="button"
                        onClick={() => handleSocialLogin('Google')}
                        className="w-full flex items-center justify-center gap-3 p-4 border border-gray-200 rounded-2xl hover:bg-gray-50 transition-all font-bold text-sm"
                    >
                        <Chrome size={20} className="text-red-500" />
                        Google
                    </button>
                    <button
                        type="button"
                        onClick={() => handleSocialLogin('Facebook')}
                        className="w-full flex items-center justify-center gap-3 p-4 bg-[#1877F2] text-white rounded-2xl hover:bg-[#166fe5] transition-all font-bold text-sm"
                    >
                        <Facebook size={20} fill="white" />
                        Facebook
                    </button>
                </div>
            </div>
        </div>
    );
};
