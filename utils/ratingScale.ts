import type { Option } from '../types';

export const RATING_VALUES_ASC = [1, 2, 3, 4, 5] as const;
export const RATING_VALUES_DESC = [5, 4, 3, 2, 1] as const;

export type RatingValue = (typeof RATING_VALUES_ASC)[number];

export function getRatingValue(option: Option): RatingValue | undefined {
  const value = option.ratingValue || Number.parseInt(option.text, 10);
  return RATING_VALUES_ASC.includes(value as RatingValue) ? value as RatingValue : undefined;
}

export function getRatingOption(options: Option[], value: RatingValue): Option | undefined {
  return options.find((option) => getRatingValue(option) === value);
}

export function sortRatingOptions(options: Option[], order: 'asc' | 'desc' = 'asc'): Option[] {
  const values = order === 'asc' ? RATING_VALUES_ASC : RATING_VALUES_DESC;
  return values.flatMap((value) => {
    const option = getRatingOption(options, value);
    return option ? [option] : [];
  });
}

export function ratingValueFromPhysicalIndex(index: number): RatingValue | undefined {
  return RATING_VALUES_ASC[index];
}

export function isRatingStarFilled(starValue: RatingValue, activeRating: number): boolean {
  return starValue <= activeRating;
}

export function calculateAverageRating(options: Option[]): number {
  const totals = options.reduce((result, option) => {
    const value = getRatingValue(option);
    const votes = option.votes || 0;
    if (!value || votes <= 0) return result;
    return { votes: result.votes + votes, score: result.score + (value * votes) };
  }, { votes: 0, score: 0 });

  return totals.votes === 0 ? 0 : totals.score / totals.votes;
}
