import React from 'react';
import { CircleCheck, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Option } from '../../types';
import { calculateAverageRating, getRatingValue, RATING_VALUES_ASC } from '../../utils/ratingScale';

interface RatingResultsSummaryProps {
  options: Option[];
  selectedOptionIds: string[];
  totalVotes: number;
}

export function RatingResultsSummary({ options, selectedOptionIds, totalVotes }: RatingResultsSummaryProps) {
  const { t, i18n } = useTranslation();
  const average = calculateAverageRating(options);
  const selected = options.find(option => selectedOptionIds.includes(option.id));
  const selectedRating = selected ? getRatingValue(selected) : undefined;

  return (
    <section data-testid="rating-results-summary" aria-label={t('rating.summary')} dir={i18n.dir()} className="mb-3.5 flex flex-wrap items-center justify-between gap-3 bg-white">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span data-testid="rating-summary-average" dir="ltr" className="whitespace-nowrap text-[30px] font-semibold leading-tight tracking-tight text-gray-900 tabular-nums">
            {average.toFixed(1)} <span className="text-[13px] font-normal tracking-normal text-gray-600">/ 5</span>
          </span>
          <span className="text-[13px] font-medium text-gray-600">{t('rating.averageLabel')}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-medium text-gray-600">
          <span className="flex gap-0.5" dir="ltr" role="img" aria-label={t('rating.choice', { value: average.toFixed(1) })}>
            {RATING_VALUES_ASC.map(value => (
              <span key={value} className="relative block h-3.5 w-3.5">
                <Star size={14} className="text-gray-300" aria-hidden="true" />
                <span className="absolute inset-y-0 left-0 overflow-hidden text-yellow-500" style={{ width: `${Math.min(1, Math.max(0, average - value + 1)) * 100}%` }}>
                  <Star size={14} fill="currentColor" className="max-w-none" aria-hidden="true" />
                </span>
              </span>
            ))}
          </span>
          <span data-testid="rating-summary-count">{t('rating.ratingCount', { count: totalVotes })}</span>
        </div>
      </div>
      {selectedRating !== undefined && (
        <span data-testid="rating-your-rating" className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-sky-50 px-2 py-2 text-xs text-sky-800">
          <CircleCheck size={14} aria-hidden="true" />
          {t('rating.yourRating')} <bdi>{selectedRating}</bdi>
          <Star size={12} fill="currentColor" aria-hidden="true" />
        </span>
      )}
    </section>
  );
}
