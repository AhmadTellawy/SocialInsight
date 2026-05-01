import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import translationEN from './locales/en/translation.json';
import translationAR from './locales/ar/translation.json';
import translationZH from './locales/zh/translation.json';
import translationHI from './locales/hi/translation.json';
import translationUR from './locales/ur/translation.json';
import translationTR from './locales/tr/translation.json';

const resources = {
  en: { translation: translationEN },
  ar: { translation: translationAR },
  zh: { translation: translationZH },
  hi: { translation: translationHI },
  ur: { translation: translationUR },
  tr: { translation: translationTR }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    react: {
      useSuspense: false,
    },
    interpolation: {
      escapeValue: false // React already does escaping
    }
  });

export default i18n;
