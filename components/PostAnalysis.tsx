import React from 'react';
import { useTranslation } from 'react-i18next';
import { demographicCountries } from '../utils/demographicSettings';

export const AggregateBars: React.FC<{ counts: Record<string, number>; labels?: Record<string, string>; locale: string }> = ({ counts, labels = {}, locale }: { counts: Record<string, number>; labels?: Record<string, string>; locale: string }) => {
  const { t } = useTranslation();
  const countryNames = Object.fromEntries(demographicCountries(locale).map(country => [country.value, country.label]));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return <div className="space-y-4">{Object.entries(counts).map(([key, count]) => <div key={key}>
    <div className="flex justify-between gap-4 text-sm mb-1"><span className="break-words">{labels[key] || t(`settingsV2.demographics.options.${key}`, { defaultValue: countryNames[key] || key })}</span><span className="tabular-nums shrink-0">{count.toLocaleString(locale)} · {total ? Math.round(count / total * 100) : 0}%</span></div>
    <div aria-hidden="true" className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-blue-600" style={{ width: `${total ? count / total * 100 : 0}%` }} /></div>
  </div>)}</div>;
};

export { ResultsAnalysis as PostAnalysis } from './analytics/ResultsAnalysis';
