import assert from 'node:assert/strict';
import test from 'node:test';
import type { Option } from '../types.ts';
import {
  calculateAverageRating,
  isRatingStarFilled,
  ratingValueFromPhysicalIndex,
  sortRatingOptions,
} from './ratingScale.ts';

const options: Option[] = [5, 1, 3, 2, 4].map((ratingValue) => ({
  id: `rating-${ratingValue}`,
  text: String(ratingValue),
  votes: ratingValue,
  isRating: true,
  ratingValue,
}));

test('maps physical left-to-right star positions to ratings 1, 3, and 5', () => {
  assert.equal(ratingValueFromPhysicalIndex(0), 1);
  assert.equal(ratingValueFromPhysicalIndex(2), 3);
  assert.equal(ratingValueFromPhysicalIndex(4), 5);
});

test('keeps input values ascending and result values descending', () => {
  assert.deepEqual(sortRatingOptions(options, 'asc').map((option) => option.ratingValue), [1, 2, 3, 4, 5]);
  assert.deepEqual(sortRatingOptions(options, 'desc').map((option) => option.ratingValue), [5, 4, 3, 2, 1]);
});

test('fills every star from one through the selected rating', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((value) => isRatingStarFilled(value as 1 | 2 | 3 | 4 | 5, 3)), [true, true, true, false, false]);
});

test('calculates the weighted average without changing rating semantics', () => {
  assert.equal(calculateAverageRating(options), 55 / 15);
  assert.equal(calculateAverageRating(options.map((option) => ({ ...option, votes: 0 }))), 0);
});
