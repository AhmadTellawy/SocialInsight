import React from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../BottomSheet';

export const UnsavedChangesDialog: React.FC<{
  open: boolean;
  onContinue: () => void;
  onDiscard: () => void;
}> = ({ open, onContinue, onDiscard }) => {
  const { t, i18n } = useTranslation();
  return (
    <BottomSheet isOpen={open} onClose={onContinue} title={t('settingsV2.unsaved.title', { defaultValue: 'Unsaved changes' })}>
      <div className="space-y-5 px-2 pb-4" dir={i18n.dir()}>
        <p className="text-sm leading-relaxed text-gray-700">{t('settingsV2.unsaved.description', { defaultValue: 'Your changes will not be saved if you leave this screen.' })}</p>
        <button type="button" onClick={onContinue} className="min-h-12 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">{t('settingsV2.unsaved.continue', { defaultValue: 'Continue editing' })}</button>
        <button type="button" onClick={onDiscard} className="min-h-12 w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">{t('settingsV2.unsaved.discard', { defaultValue: 'Discard changes' })}</button>
      </div>
    </BottomSheet>
  );
};
