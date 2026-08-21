import React, { useMemo, useState } from 'react';
import { AlertCircle, Check, Loader2, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Option } from '../../types';
import { getPercentage } from '../../utils/formatters';
import {
  getRatingOption,
  getRatingValue,
  isRatingStarFilled,
  RATING_VALUES_ASC,
  RATING_VALUES_DESC,
} from '../../utils/ratingScale';
import type { RatingValue } from '../../utils/ratingScale';

interface RatingScaleQuestionProps {
  options: Option[];
  selectedOptionIds: string[];
  showResults: boolean;
  disabled?: boolean;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  totalVotes?: number;
  onSelect?: (option: Option) => void;
}

export const RatingScaleQuestion: React.FC<RatingScaleQuestionProps> = ({
  options,
  selectedOptionIds,
  showResults,
  disabled = false,
  isSubmitting = false,
  errorMessage,
  totalVotes = 0,
  onSelect,
}) => {
  const { t, i18n } = useTranslation();
  const [previewRating, setPreviewRating] = useState<number>(0);
  const selectedRating = useMemo(() => {
    const selected = options.find((option) => selectedOptionIds.includes(option.id));
    return selected ? getRatingValue(selected) || 0 : 0;
  }, [options, selectedOptionIds]);
  const activeRating = previewRating || selectedRating;

  if (showResults) {
    return (
      <div className="space-y-2" dir="ltr" role="list" data-testid="rating-scale-results">
        {RATING_VALUES_DESC.map((ratingValue) => {
          const option = getRatingOption(options, ratingValue);
          if (!option) return null;
          const isSelected = selectedOptionIds.includes(option.id);
          const votes = option.votes || 0;
          const percentage = getPercentage(votes, totalVotes);
          const voteLabel = t('rating.voteCount', { count: votes });

          return (
            <div
              key={option.id}
              role="listitem"
              data-testid="rating-result-row"
              data-rating-value={ratingValue}
              data-selected={isSelected ? 'true' : 'false'}
              aria-label={`${t('rating.choice', { value: ratingValue })}: ${percentage}% · ${voteLabel}`}
              className={`min-h-[58px] rounded-xl border px-3 py-2 transition-colors ${
                isSelected ? 'border-blue-400 bg-blue-50/60' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${isSelected ? 'bg-blue-600 text-white' : 'bg-transparent'}`}>
                    {isSelected && <Check size={10} strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <div className="flex shrink-0 gap-0.5 text-yellow-500" aria-hidden="true">
                    {Array.from({ length: ratingValue }).map((_, index) => (
                      <Star key={index} size={16} fill="currentColor" />
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-baseline gap-1 whitespace-nowrap text-[11px]" dir="auto" data-testid="rating-result-summary">
                  <span className={`text-[13px] font-bold tabular-nums ${isSelected ? 'text-blue-700' : 'text-gray-800'}`}>{percentage}%</span>
                  <span className="text-gray-400">·</span>
                  <span className="font-medium text-gray-500">{voteLabel}</span>
                </div>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percentage}
                aria-label={t('rating.resultProgress', { value: ratingValue })}
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${isSelected ? 'bg-blue-600' : 'bg-gray-300'}`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const updatePointerPreview = (event: React.PointerEvent<HTMLButtonElement>, value: RatingValue) => {
    if (event.pointerType === 'mouse' && !disabled && !isSubmitting) setPreviewRating(value);
  };

  return (
    <div
      className="rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2.5"
      data-testid="rating-scale-input"
      aria-busy={isSubmitting}
    >
      <p className="text-xs font-semibold text-gray-600" dir="auto">{t('rating.prompt')}</p>
      <div
        className="mt-1 flex w-full items-center justify-between"
        dir="ltr"
        role="group"
        aria-label={t('rating.prompt')}
        onPointerLeave={() => setPreviewRating(0)}
      >
        {RATING_VALUES_ASC.map((ratingValue) => {
          const option = getRatingOption(options, ratingValue);
          const filled = isRatingStarFilled(ratingValue, activeRating);
          const isSelected = selectedRating === ratingValue;
          const isDisabled = disabled || isSubmitting || !option;

          return (
            <button
              key={ratingValue}
              type="button"
              data-testid="rating-star"
              data-rating-value={ratingValue}
              data-filled={filled ? 'true' : 'false'}
              aria-label={t('rating.choice', { value: ratingValue })}
              aria-pressed={isSelected}
              disabled={isDisabled}
              title={t('rating.choice', { value: ratingValue })}
              onPointerEnter={(event) => updatePointerPreview(event, ratingValue)}
              onFocus={() => !isDisabled && setPreviewRating(ratingValue)}
              onBlur={() => setPreviewRating(0)}
              onClick={() => option && onSelect?.(option)}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-default ${
                filled ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400'
              }`}
            >
              <Star size={30} fill={filled ? 'currentColor' : 'none'} strokeWidth={1.8} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[11px] font-medium text-gray-500" dir="ltr">
        <span dir="auto">1 · {t('rating.worst')}</span>
        <span dir="auto">5 · {t('rating.best')}</span>
      </div>
      <div className="mt-1 min-h-[18px] text-[11px]" aria-live="polite">
        {isSubmitting ? (
          <span className="flex items-center gap-1.5 text-gray-500" dir={i18n.dir()}>
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            {t('rating.submitting')}
          </span>
        ) : errorMessage ? (
          <span className="flex items-center gap-1.5 text-red-600" role="alert" dir={i18n.dir()}>
            <AlertCircle size={12} aria-hidden="true" />
            {errorMessage}
          </span>
        ) : null}
      </div>
    </div>
  );
};
