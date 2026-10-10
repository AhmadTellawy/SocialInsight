import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisQueryString, answerPercentage, percentagePointDifference } from './analysis.ts';
test('multiselect percentages use question respondents and differences use percentage points', () => {
  assert.equal(answerPercentage(15, 20), 75); assert.equal(answerPercentage(0, 0), 0);
  assert.equal(percentagePointDifference(5, 5, 15, 20), 25);
});
test('filter query preserves Unicode, multiple values and combines filters without duplicate or empty selections', () => {
  const params = new URLSearchParams(analysisQueryString({ country: ['الأردن', 'مصر', 'الأردن'], gender: ['Male'], age: [] }, 'q/1', 'marital'));
  assert.equal(params.get('questionId'), 'q/1'); assert.equal(params.get('compareBy'), 'marital');
  assert.deepEqual(JSON.parse(params.get('filters')!), { country: ['الأردن', 'مصر'], gender: ['Male'] });
  assert.equal(analysisQueryString({}), 'analysis=1');
});
