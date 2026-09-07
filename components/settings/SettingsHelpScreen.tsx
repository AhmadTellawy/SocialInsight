import React from 'react';
import { ArrowLeft, ChevronRight, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export const SettingsHelpScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  return <section dir={i18n.dir()} className="flex h-full min-h-0 flex-col bg-gray-50">
    <header className="flex min-h-16 items-center gap-2 border-b border-gray-100 bg-white px-3"><button type="button" onClick={onBack} aria-label={t('common.back', { defaultValue: 'Back' })} className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-blue-600"><ArrowLeft className="rtl:rotate-180" size={23} /></button><h1 className="text-base font-bold">{t('settingsV2.help.title')}</h1></header>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-5"><div className="mx-auto max-w-lg space-y-4">
      {['saving', 'privacy', 'notifications', 'access', 'safety'].map((topic) => <details key={topic} className="rounded-2xl border border-gray-200 bg-white p-4"><summary className="min-h-11 cursor-pointer text-sm font-bold leading-6 text-gray-900">{t(`settingsV2.help.${topic}Title`)}</summary><p className="mt-2 text-sm leading-relaxed text-gray-600">{t(`settingsV2.help.${topic}Body`)}</p></details>)}
      <button type="button" onClick={() => navigate('/privacy')} className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 text-start text-sm font-bold"><Shield size={20} /><span className="flex-1">{t('Privacy Policy', { defaultValue: 'Privacy policy' })}</span><ChevronRight size={18} className="rtl:rotate-180" /></button>
    </div></div>
  </section>;
};
