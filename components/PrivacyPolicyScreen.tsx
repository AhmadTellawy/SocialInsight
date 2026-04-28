import React from 'react';
import { ArrowLeft, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const PrivacyPolicyScreen: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300 z-50">
            <div className="bg-white border-b border-gray-100 flex items-center px-4 h-14 sticky top-0 z-30">
                <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-gray-600 hover:bg-gray-50 rounded-full transition-colors">
                    <ArrowLeft size={24} />
                </button>
                <div className="flex items-center gap-2 ml-2 text-gray-900">
                    <Shield size={20} className="text-blue-600" />
                    <span className="font-bold text-lg">Privacy Policy</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-10 no-scrollbar max-w-3xl mx-auto w-full">
                <div className="space-y-8 pb-20 text-gray-700 leading-relaxed text-sm">
                    <div className="text-center mb-10">
                        <h1 className="text-3xl font-black text-gray-900 mb-4">Privacy Policy</h1>
                        <p className="text-gray-500 font-medium">Last updated: April 2026</p>
                    </div>

                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-gray-900">1. Introduction</h2>
                        <p>
                            Welcome to SocialInsight. We respect your privacy and are committed to protecting your personal data. 
                            This privacy policy will inform you about how we look after your personal data when you visit our 
                            application and tell you about your privacy rights and how the law protects you.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-gray-900">2. The Data We Collect About You</h2>
                        <p>We may collect, use, store and transfer different kinds of personal data about you which we have grouped together as follows:</p>
                        <ul className="list-disc pl-5 space-y-2">
                            <li><strong>Identity Data:</strong> includes first name, last name, username or similar identifier.</li>
                            <li><strong>Contact Data:</strong> includes email address and telephone numbers.</li>
                            <li><strong>Demographic Data:</strong> includes gender, age group, education, and employment status.</li>
                            <li><strong>Technical Data:</strong> includes internet protocol (IP) address, your login data, browser type and version, time zone setting and location.</li>
                            <li><strong>Usage Data:</strong> includes information about how you use our application (e.g., dwell time, interaction events).</li>
                        </ul>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-gray-900">3. How We Use Your Personal Data</h2>
                        <p>We will only use your personal data when the law allows us to. Most commonly, we will use your personal data in the following circumstances:</p>
                        <ul className="list-disc pl-5 space-y-2">
                            <li>To register you as a new user.</li>
                            <li>To provide context to survey authors (demographic data is anonymized).</li>
                            <li>To manage our relationship with you, including notifying you about changes to our terms or privacy policy.</li>
                            <li>To administer and protect our business and this application (including troubleshooting, data analysis, testing, system maintenance).</li>
                            <li>To use data analytics to improve our website, products/services, marketing, customer relationships and experiences.</li>
                        </ul>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-gray-900">4. Anonymity and Public Data</h2>
                        <p>
                            SocialInsight allows you to participate in surveys, polls, and challenges anonymously. When you choose to interact anonymously, your 
                            identity is stripped from the interaction and the author of the post will only see your vote alongside your anonymized demographic data. 
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-gray-900">5. Your Legal Rights (GDPR)</h2>
                        <p>Under certain circumstances, you have rights under data protection laws in relation to your personal data:</p>
                        <ul className="list-disc pl-5 space-y-2">
                            <li><strong>Request access</strong> to your personal data (commonly known as a "data subject access request").</li>
                            <li><strong>Request correction</strong> of the personal data that we hold about you.</li>
                            <li><strong>Request erasure</strong> of your personal data. You can delete your account directly from your Profile Settings.</li>
                            <li><strong>Object to processing</strong> of your personal data where we are relying on a legitimate interest.</li>
                            <li><strong>Request restriction of processing</strong> of your personal data.</li>
                        </ul>
                    </section>

                    <section className="space-y-4 p-6 bg-blue-50 rounded-2xl border border-blue-100">
                        <h2 className="text-xl font-bold text-blue-900">Contact Us</h2>
                        <p className="text-blue-800">
                            If you have any questions about this privacy policy or our privacy practices, please contact us at:
                            <br /><br />
                            <strong>Email:</strong> privacy@socialinsightapp.com<br />
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
};
