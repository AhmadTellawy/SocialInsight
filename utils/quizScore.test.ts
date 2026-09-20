import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateQuizScore } from './quizScore.ts';

const questions = [
  { id: 'q1', correctOptionId: 'a1', options: [{ id: 'a1' }, { id: 'a2' }] },
  { id: 'q2', options: [{ id: 'b1', isCorrect: true }, { id: 'b2' }] }
];

test('missing score inputs are unknown rather than an invented zero', () => {
  assert.equal(calculateQuizScore([], {}), null);
  assert.equal(calculateQuizScore(questions, undefined), null);
  assert.equal(calculateQuizScore(questions, null), null);
});

test('completed progress counts skipped or unanswered questions as incorrect', () => {
  assert.deepEqual(calculateQuizScore(questions, { q1: 'a1' }), { correct: 1, total: 2 });
  assert.deepEqual(calculateQuizScore(questions, {}), { correct: 0, total: 2 });
});

test('a known all-wrong result preserves the real zero', () => {
  assert.deepEqual(calculateQuizScore(questions, { q1: 'a2', q2: 'b2' }), { correct: 0, total: 2 });
});

test('recalculation follows changed answers and question structure', () => {
  assert.deepEqual(calculateQuizScore(questions, { q1: 'a1', q2: 'b2' }), { correct: 1, total: 2 });
  const changedQuestions = [
    questions[0],
    { ...questions[1], options: [{ id: 'b1' }, { id: 'b2', isCorrect: true }] }
  ];
  assert.deepEqual(calculateQuizScore(changedQuestions, { q1: 'a1', q2: 'b2' }), { correct: 2, total: 2 });
});
