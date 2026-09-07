import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, Info, Loader2, Lock, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UserProfile } from '../../types';
import { api } from '../../services/api';
import { BottomSheet } from '../BottomSheet';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';
import { changeDemographic, DEMOGRAPHIC_FIELDS, DEMOGRAPHIC_OPTIONS, demographicCountries, demographicHasChanges, demographicSnapshot, searchDemographicCountries } from '../../utils/demographicSettings';
import type { DemographicDraft, DemographicField } from '../../utils/demographicSettings';

export const DemographicSettingsScreen: React.FC<{
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => void;
  onBack: () => void;
}> = ({ userProfile, onUpdateProfile, onBack }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(() => demographicSnapshot(userProfile.demographics));
  const [draft, setDraft] = useState<DemographicDraft>(saved);
  const [profile, setProfile] = useState(userProfile);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [selector, setSelector] = useState<DemographicField | null>(null);
  const [selectorChoice, setSelectorChoice] = useState<string | null>(null);
  useEffect(() => { setSelectorChoice(null); }, [selector]);
  const selectedOption = selectorChoice ?? (selector ? draft[selector] : '');
  const [search, setSearch] = useState('');
  const [localLeave, setLocalLeave] = useState(false);
  const savingRef = useRef(false);
  const ignoreNextNavigation = useRef(false);
  const updateRef = useRef(onUpdateProfile);
  useEffect(() => { updateRef.current = onUpdateProfile; }, [onUpdateProfile]);
  const dirty = demographicHasChanges(draft, saved);
  const language = i18n.language.split('-')[0] || 'en';
  const countries = useMemo(() => demographicCountries(language), [language]);
  const filteredCountries = useMemo(() => searchDemographicCountries(language, search), [search, language]);
  const optionLabel = (value: string): string => value
    ? t(`settingsV2.demographics.options.${value}`, { defaultValue: value })
    : t('settingsV2.demographics.notSpecified', { defaultValue: 'Not specified' });
  const fieldLabel = (field: string): string => t(`settingsV2.demographics.fields.${field}`, { defaultValue: field });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    api.getMe({ signal: controller.signal, timeoutMs: 15_000 }).then((loaded) => {
      if (controller.signal.aborted) return;
      const nextProfile = { ...userProfile, ...loaded } as UserProfile;
      const snapshot = demographicSnapshot(nextProfile.demographics);
      setProfile(nextProfile);
      setSaved(snapshot);
      setDraft(snapshot);
      updateRef.current(nextProfile);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [userProfile.id, retryKey]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (ignoreNextNavigation.current) {
      ignoreNextNavigation.current = false;
      return false;
    }
    return dirty && currentLocation.pathname !== nextLocation.pathname;
  });
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const change = (field: DemographicField, value: string) => {
    setDraft((current) => changeDemographic(current, field, value));
    setSavedNotice(false);
    setSaveError(false);
    setSelector(null); setSearch('');
  };
  const reconcile = async (submitted: DemographicDraft, baseline: DemographicDraft) => {
    setNeedsReload(true);
    const next = { ...profile, ...await api.getMe({ timeoutMs: 15_000 }) } as UserProfile;
    const snapshot = demographicSnapshot(next.demographics);
    setProfile(next);
    setSaved(snapshot);
    updateRef.current(next);
    setNeedsReload(false);
    if (!demographicHasChanges(submitted, snapshot)) {
      setDraft(snapshot);
      setSaveError(false);
      setSaveConflict(false);
      setSavedNotice(true);
    } else {
      // Keep local edits, while refreshing fields that this form did not edit.
      // A fresh version never causes an automatic overwrite of another device.
      const retained = { ...snapshot };
      for (const field of DEMOGRAPHIC_FIELDS) {
        if (submitted[field] !== baseline[field]) retained[field] = submitted[field];
      }
      setDraft(retained);
      setSaveError(false);
      setSaveConflict(true);
    }
  };
  const retryRead = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try { await reconcile(draft, saved); }
    catch { setSaveError(true); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const save = async () => {
    if (!dirty || loading || loadError || needsReload || savingRef.current || !profile.id) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    setSavedNotice(false);
    setSaveConflict(false);
    try {
      const updated = await api.updateUser(profile.id, { demographics: { ...draft }, expectedUpdatedAt: profile.updatedAt });
      const next = { ...profile, ...updated, demographics: updated.demographics || { ...draft, ageGroup: profile.demographics?.ageGroup } } as UserProfile;
      const snapshot = demographicSnapshot(next.demographics);
      setSaved(snapshot);
      setDraft(snapshot);
      setProfile(next);
      updateRef.current(next);
      setSavedNotice(true);
    } catch {
      setSaveError(true);
      try { await reconcile(draft, saved); }
      catch { /* Keep the draft and disable writes until its version is known. */ }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const continueEditing = () => {
    setLocalLeave(false);
    if (blocker.state === 'blocked') blocker.reset();
  };
  const discard = () => {
    if (savingRef.current) return;
    setDraft(saved);
    setSelector(null);
    setLocalLeave(false);
    if (blocker.state === 'blocked') blocker.proceed();
    else {
      ignoreNextNavigation.current = true;
      onBack();
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-gray-50" dir={i18n.dir()}>
      <header className="sticky top-0 z-20 flex min-h-16 items-center gap-2 border-b border-gray-100 bg-white px-3">
        <button type="button" onClick={() => dirty ? setLocalLeave(true) : onBack()} disabled={saving} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-700 focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50" aria-label={t('common.back', { defaultValue: 'Back' })}><ArrowLeft className="rtl:rotate-180" size={23} /></button>
        <h1 className="min-w-0 flex-1 text-base font-bold text-gray-900">{t('settingsV2.demographics.title', { defaultValue: 'Demographic information' })}</h1>
        <button type="button" onClick={() => void save()} disabled={!dirty || loading || loadError || needsReload || saving} className="flex min-h-11 min-w-20 items-center justify-center gap-2 rounded-full bg-blue-600 px-4 text-sm font-bold text-white disabled:bg-gray-100 disabled:text-gray-500 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">{saving && <Loader2 size={16} className="animate-spin" />}{t(saving ? 'profile.edit.saving' : 'profile.edit.save', { defaultValue: saving ? 'Saving...' : 'Save' })}</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-5">
        <div className="mx-auto max-w-lg space-y-5">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-relaxed text-blue-950">
            <p className="mb-2 flex items-center gap-2 font-bold"><Info size={18} />{t('settingsV2.demographics.optionalTitle', { defaultValue: 'Optional information, useful insights' })}</p>
            <p>{t('settingsV2.demographics.purpose', { defaultValue: 'These optional details help describe participation in aggregate insights. They are not displayed on your public profile. You can leave fields blank or clear them at any time.' })}</p>
            <button type="button" onClick={() => navigate('/privacy')} className="mt-2 min-h-11 font-bold underline underline-offset-4">{t('Privacy Policy', { defaultValue: 'Privacy policy' })}</button>
          </div>
          {loading && <p role="status" className="flex items-center gap-2 text-sm text-gray-600"><Loader2 size={18} className="animate-spin" />{t('settingsV2.loading', { defaultValue: 'Loading your settings...' })}</p>}
          {loadError && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{t('settingsV2.loadFailed', { defaultValue: 'Your settings could not be loaded. Try again before making changes.' })}</p><button type="button" onClick={() => setRetryKey((value) => value + 1)} className="mt-2 flex min-h-11 items-center gap-2 font-bold"><RefreshCw size={17} />{t('common.retry', { defaultValue: 'Retry' })}</button></div>}
          {saveError && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{t('settingsV2.demographics.saveFailed')}</p><button type="button" disabled={saving} onClick={() => void retryRead()} className="mt-2 flex min-h-11 items-center gap-2 font-bold disabled:opacity-50"><RefreshCw size={17} />{t('settingsV2.reload', { defaultValue: 'Reload settings' })}</button></div>}
          {saveConflict && <p role="alert" className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">{t('settingsV2.demographics.saveConflict')}</p>}
          {savedNotice && <p role="status" className="rounded-2xl bg-green-50 p-4 text-sm font-semibold text-green-800">{t('settingsV2.saved', { defaultValue: 'Changes saved' })}</p>}
          <fieldset disabled={loading || loadError || needsReload || saving} className="overflow-hidden rounded-2xl border border-gray-200 bg-white disabled:opacity-60">
            <legend className="sr-only">{t('settingsV2.demographics.title', { defaultValue: 'Demographic information' })}</legend>
            {DEMOGRAPHIC_FIELDS.filter((field) => !['industry', 'sector'].includes(field) || !['Unemployed', 'Homemaker'].includes(draft.employment)).map((field) => (
              <button key={field} type="button" onClick={() => { setSelector(field); setSearch(''); }} className="flex min-h-[76px] w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-start last:border-0 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600">
                <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-gray-900">{fieldLabel(field)}</span><span className="mt-1 block text-sm leading-relaxed text-gray-600">{field === 'nationality' && draft.nationality ? countries.find((country) => country.value === draft.nationality)?.label || draft.nationality : optionLabel(draft[field])}</span></span><ChevronRight className="shrink-0 text-gray-400 rtl:rotate-180" size={18} />
              </button>
            ))}
          </fieldset>
          <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700"><Lock size={18} className="mt-0.5 shrink-0" /><div><p className="font-bold">{fieldLabel('ageGroup')}: <bdi>{profile.demographics?.ageGroup || optionLabel('')}</bdi></p><p className="mt-1 leading-relaxed">{t('settingsV2.demographics.ageHint', { defaultValue: 'Calculated from your date of birth. You can manage your date of birth in Edit profile; it is not visible to others.' })}</p></div></div>
          <button type="button" disabled={loading || loadError || needsReload || saving || !DEMOGRAPHIC_FIELDS.some((field) => draft[field])} onClick={() => { setDraft(demographicSnapshot()); setSavedNotice(false); }} className="min-h-11 rounded-xl px-2 text-sm font-semibold text-red-700 underline underline-offset-4 disabled:text-gray-400">{t('settingsV2.demographics.clear', { defaultValue: 'Clear optional information' })}</button>
        </div>
      </div>
      <BottomSheet isOpen={Boolean(selector)} onClose={() => setSelector(null)} title={selector ? fieldLabel(selector) : ''}>
        <div dir={i18n.dir()} className="space-y-3 pb-4">
          {selector === 'nationality' && <label className="flex items-center gap-2 rounded-xl border border-gray-300 px-3"><Search size={18} className="text-gray-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} type="search" className="min-h-12 w-full min-w-0 bg-transparent text-sm outline-none" placeholder={t('settingsV2.demographics.searchCountry', { defaultValue: 'Search countries in Arabic or English' })} aria-label={t('settingsV2.demographics.searchCountry', { defaultValue: 'Search countries in Arabic or English' })} /></label>}
          <div role="radiogroup" aria-label={selector ? fieldLabel(selector) : undefined} className="max-h-[55dvh] space-y-2 overflow-y-auto" onKeyDown={(event) => {
            const keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];
            if (!selector || !keys.includes(event.key)) return;
            const radios = Array.from((event.currentTarget as HTMLDivElement).querySelectorAll<HTMLButtonElement>('[role="radio"]'));
            const index = radios.indexOf(document.activeElement as HTMLButtonElement);
            if (index < 0 || !radios.length) return;
            event.preventDefault();
            const forward = event.key === 'ArrowDown' || event.key === (i18n.dir() === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1 : (index + (forward ? 1 : -1) + radios.length) % radios.length;
            radios[next].focus();
            // Arrow keys preview a choice; activate it to commit dependent-field changes.
            setSelectorChoice(radios[next].dataset.value || '');
          }}>
            {selector && [{ value: '', label: optionLabel('') }, ...(selector === 'nationality' ? filteredCountries : DEMOGRAPHIC_OPTIONS[selector].map((value) => ({ value, label: optionLabel(value) })))].map(({ value, label }) => (
              <button type="button" role="radio" data-value={value} aria-checked={selectedOption === value} tabIndex={selectedOption === value || (value === '' && selector === 'nationality' && !filteredCountries.some((country) => country.value === selectedOption)) ? 0 : -1} key={value || 'empty'} onClick={() => change(selector!, value)} className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-start text-sm focus-visible:ring-2 focus-visible:ring-blue-600 ${selectedOption === value ? 'border-blue-600 bg-blue-50 font-bold text-blue-800' : 'border-gray-200 text-gray-800'}`}><span>{label}</span>{selectedOption === value && <Check size={18} className="shrink-0" />}</button>
            ))}
            {selector === 'nationality' && filteredCountries.length === 0 && <p role="status" className="p-4 text-sm text-gray-600">{t('settingsV2.demographics.noCountries', { defaultValue: 'No matching countries. Try another spelling.' })}</p>}
          </div>
        </div>
      </BottomSheet>
      <UnsavedChangesDialog open={!saving && (localLeave || blocker.state === 'blocked')} onContinue={continueEditing} onDiscard={discard} />
    </section>
  );
};
