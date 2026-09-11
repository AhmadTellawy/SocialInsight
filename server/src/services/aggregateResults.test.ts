import test from 'node:test';
import assert from 'node:assert/strict';
import { AggregateResults, protectDistribution } from './aggregateResults';

test('small-cell suppression withholds complementary cells, including unknown groups', () => {
  assert.deepEqual(protectDistribution({ Male: 9, Female: 1 }, 10), { counts: {}, suppressionReason: 'SMALL_CELLS' });
  assert.deepEqual(protectDistribution({ Male: 5, Unknown: 1 }, 6).counts, {});
  assert.equal(protectDistribution({ Male: 4 }, 4).suppressionReason, 'SMALL_SAMPLE');
  assert.deepEqual(protectDistribution({ Male: 5, Female: 5, Other: 0 }, 10).counts, { Male: 5, Female: 5, Other: 0 });
});

test('aggregate DTO never includes response identifiers, text, DOB or response-demographic pairs', () => {
  const aggregate = new AggregateResults();
  aggregate.add({ answers: [{ questionId: 'q1', optionId: 'option1', textValue: 'PRIVATE FREE TEXT' }], user: { birthday: new Date('1989-04-12'), country: 'Jordan', demographics: { gender: 'Female' } } });
  const result = aggregate.toJSON();
  assert.equal(result.sampleSize, 1);
  assert.deepEqual(result.questionSummaries, [{ questionId: 'q1', responseCount: 1, optionCounts: { option1: 1 }, textResponseCount: 1 }]);
  assert.equal(result.demographicBreakdowns.country.suppressionReason, 'SMALL_SAMPLE');
  const serialized = JSON.stringify(result);
  for (const value of ['PRIVATE FREE TEXT', '1989', 'Jordan', 'Female', 'userId', 'isAnonymous']) assert.equal(serialized.includes(value), false, value);
});

test('multiple choice responses count respondents once and quiz scores require the exact correct option set', () => {
  const aggregate = new AggregateResults(new Map([['q', new Set(['a', 'b'])]]));
  for (let index = 0; index < 5; index++) aggregate.add({ answers: [{ questionId: 'q', optionId: 'a' }, { questionId: 'q', optionId: 'a' }, { questionId: 'q', optionId: 'b' }] });
  for (let index = 0; index < 5; index++) aggregate.add({ answers: [{ questionId: 'q', optionId: 'a' }] });
  const result = aggregate.toJSON();
  assert.deepEqual(result.questionSummaries[0].optionCounts, { a: 10, b: 5 });
  assert.equal(result.questionSummaries[0].responseCount, 10);
  assert.equal(result.scoreDistribution?.counts['91–100%'], 5);
  assert.equal(result.scoreDistribution?.counts['0–50%'], 5);
});
