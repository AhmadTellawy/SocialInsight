import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRENDING_MAX_POSTS_PER_CREATOR,
  TRENDING_HASHTAG_WINDOW_DAYS,
  calculateTopicPostScore,
  calculateTrendingHashtagScore,
  registerTrendingCreatorContribution
} from './hashtagService';

test('topic ranking is deterministic and favors useful recent engagement', () => {
  const now = Date.parse('2026-08-22T12:00:00.000Z');
  const recent = calculateTopicPostScore({
    createdAt: new Date(now - 60 * 60 * 1000),
    responseCount: 8,
    commentsCount: 3,
    likesCount: 5,
    sharesCount: 1
  }, now);
  const stale = calculateTopicPostScore({
    createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
    responseCount: 8,
    commentsCount: 3,
    likesCount: 5,
    sharesCount: 1
  }, now);
  assert.equal(recent > stale, true);
  assert.equal(calculateTopicPostScore({
    createdAt: new Date(now - 60 * 60 * 1000),
    responseCount: 8,
    commentsCount: 3,
    likesCount: 5,
    sharesCount: 1
  }, now), recent);
});

test('trending score rewards creator diversity and caps engagement influence', () => {
  const baseline = calculateTrendingHashtagScore({
    recencyWeightTotal: 5,
    uniqueCreatorCount: 1,
    engagementTotal: 0
  });
  const diverse = calculateTrendingHashtagScore({
    recencyWeightTotal: 5,
    uniqueCreatorCount: 5,
    engagementTotal: 0
  });
  const extremeEngagement = calculateTrendingHashtagScore({
    recencyWeightTotal: 5,
    uniqueCreatorCount: 1,
    engagementTotal: 1_000_000
  });
  assert.equal(TRENDING_HASHTAG_WINDOW_DAYS, 7);
  assert.equal(diverse > baseline, true);
  assert.equal(extremeEngagement <= baseline * 1.3, true);
});

test('trending scoring caps repeated contributions from one creator', () => {
  const creatorCounts = new Map<string, number>();
  for (let index = 0; index < TRENDING_MAX_POSTS_PER_CREATOR; index += 1) {
    assert.equal(registerTrendingCreatorContribution(creatorCounts, 'creator-1'), true);
  }
  assert.equal(registerTrendingCreatorContribution(creatorCounts, 'creator-1'), false);
  assert.equal(registerTrendingCreatorContribution(creatorCounts, 'creator-2'), true);
});
