import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisResults, ANALYSIS_DIMENSIONS, parseAnalysisQuery, InvalidAnalysisQuery } from './analysisResults';
import { analysisPageQuery } from './analysisData';
import { AggregateResults } from './aggregateResults';

function fixture() {
  const analysis = new AnalysisResults(), aggregate = new AggregateResults();
  const add = (count: number, gender: string, maritalStatus: string, chosen: string[], extra: object = {}) => {
    for (let i = 0; i < count; i++) {
      const row = { answers: [{ questionId: 'q1', optionId: chosen[0] }, ...chosen.map(optionId => ({ questionId: 'q2', optionId })), ...chosen.map(optionId => ({ questionId: 'q2', optionId }))], user: { birthday: new Date('1990-01-01'), country: 'Jordan', demographics: { gender, maritalStatus, nationality: 'Jordan', ...extra } } };
      analysis.add(row); aggregate.add(row);
    }
  };
  return { analysis, aggregate, add, read: (query = {}) => analysis.toJSON({ filters: {}, ...query }, aggregate.toJSON()) };
}
test('compound filtering, nine comparisons, answer denominators and deduplicated multiple selections reconcile', () => {
  const f = fixture(); f.add(10, 'Male', 'Single', ['a', 'b']); f.add(5, 'Female', 'Single', ['b']); f.add(5, 'Female', 'Married', ['a']);
  for (const compareBy of ANALYSIS_DIMENSIONS) {
    const result = f.read({ compareBy, questionId: 'q2' });
    assert.equal(result.version, 3); assert.equal(result.sampleSize, 20);
    assert.equal(result.comparison!.groups.reduce((n, group) => n + group.responseCount, 0), 20);
    assert.deepEqual(result.comparison!.overall!.optionCounts, { a: 15, b: 15 });
  }
  const result = f.read({ filters: { gender: ['Female'], marital: ['Single'] }, compareBy: 'gender', questionId: 'q2' });
  assert.equal(result.sampleSize, 5); assert.deepEqual(result.comparison!.overall!.optionCounts, { b: 5 });
  assert.equal(result.comparison!.groups.length, 1);
  assert.deepEqual(result.filterOptions.gender, ['Female', 'Male']);
});
test('a rare complete demographic/answer profile blocks differencing even when every displayed marginal looks large', () => {
  const f = fixture(); f.add(9, 'Male', 'Single', ['a']); f.add(1, 'Male', 'Married', ['a']); f.add(9, 'Female', 'Married', ['b']); f.add(1, 'Female', 'Single', ['b']);
  const overall = f.read(); assert.equal(overall.sampleSize, 20); assert.equal(overall.questionSummaries.length, 2);
  for (const compareBy of ANALYSIS_DIMENSIONS) { const result = f.read({ compareBy }); assert.equal(result.comparison!.suppressionReason, 'SMALL_CELLS'); assert.deepEqual(result.comparison!.groups, []); assert.deepEqual(result.filterOptions, {}); }
  for (const gender of ['Male', 'Female', 'Never existed']) { const result = f.read({ filters: { gender: [gender] } }); assert.equal(result.sampleSize, null); assert.deepEqual(result.questionSummaries, []); }
});
test('answer-pattern intersections and unknown demographics are protected across questions', () => {
  const f = fixture(); f.add(9, 'Unknown', 'Unknown', ['a', 'b']); f.add(1, 'Unknown', 'Unknown', ['a']);
  const result = f.read({ compareBy: 'gender' }); assert.deepEqual(result.comparison!.groups, []); assert.equal(result.comparison!.suppressionReason, 'SMALL_CELLS');
});
test('DTO never contains raw responses, free text, identifiers or birthdays', () => {
  const analysis = new AnalysisResults(), aggregate = new AggregateResults();
  for (let i = 0; i < 5; i++) { const row = { id: `response-${i}`, userId: 'person-secret', answers: [{ questionId: 'q', textValue: 'PRIVATE FREE TEXT' }], user: { birthday: new Date('1990-01-01'), country: 'Jordan', demographics: { gender: 'Male' } } }; analysis.add(row); aggregate.add(row); }
  const result = analysis.toJSON({ filters: {}, compareBy: 'country' }, aggregate.toJSON());
  assert.equal(result.questionSummaries[0].textResponseCount, 5);
  for (const token of ['PRIVATE FREE TEXT', 'response-', 'person-secret', '1990', 'birthday', 'textValue', 'userId', 'answers']) assert.equal(JSON.stringify(result).includes(token), false, token);
});
test('empty filters and nonexistent categories return a real zero rather than invented data', () => {
  const f = fixture(); f.add(5, 'Male', 'Single', ['a']);
  const result = f.read({ filters: { country: ['Missing'] }, compareBy: 'country' });
  assert.equal(result.sampleSize, 0); assert.deepEqual(result.questionSummaries, []); assert.deepEqual(result.comparison!.groups, []);
  assert.equal(fixture().read().sampleSize, 0);
});
test('query parser bounds inputs, rejects unsupported dimensions/objects and keeps old results compatible', () => {
  assert.equal(parseAnalysisQuery(), undefined); assert.equal(parseAnalysisQuery({}), undefined);
  assert.deepEqual(parseAnalysisQuery({ analysis: '1', compareBy: 'marital', filters: '{"gender":["Male"]}' }), { questionId: undefined, compareBy: 'marital', filters: { gender: ['Male'] } });
  for (const query of [{ analysis: ['1'] }, { analysis: '1', compareBy: '__proto__' }, { analysis: '1', questionId: ['q'] }, { analysis: '1', filters: '[]' }, { analysis: '1', filters: '{"userId":["x"]}' }, { analysis: '1', filters: '{"gender":[5]}' }, { analysis: '1', filters: '{"gender":{}}' }, { analysis: '1', filters: ' '.repeat(5000) }]) assert.throws(() => parseAnalysisQuery(query), InvalidAnalysisQuery);
});

test('analysis keyset binds a timezone-independent timestamp and parameterizes all cursor values', () => {
  const timestamp = new Date('2026-10-10T14:59:51.528Z');
  const postId = "post'; SELECT private_data; --";
  const cursorId = "cursor'; --";
  const query = analysisPageQuery(postId, { id: cursorId, timestamp });
  assert.deepEqual(query.values, [postId, timestamp.toISOString(), cursorId]);
  assert.match(query.sql, /\?::timestamp/);
  assert.equal(query.sql.includes(postId), false);
  assert.equal(query.sql.includes(cursorId), false);
  assert.match(query.sql, /ORDER BY timestamp DESC, id DESC LIMIT 500/);
  assert.deepEqual(analysisPageQuery('post').values, ['post']);
});
