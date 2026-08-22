import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  MENTION_RECIPIENT_LIMIT,
  findActiveMentionQuery,
  getUniqueHashtags,
  getUniqueMentionHandles,
  parseTextEntities,
} from './textEntities.ts';

interface TestVector {
  name: string;
  text: string;
  entities: Array<{ type: string; raw: string; value: string; normalizedValue: string }>;
}

const vectors = JSON.parse(
  fs.readFileSync(new URL('../shared/textEntityTestVectors.json', import.meta.url), 'utf8'),
) as TestVector[];

for (const vector of vectors) {
  test(`frontend tokenizer: ${vector.name}`, () => {
    const entities = parseTextEntities(vector.text);
    assert.deepEqual(
      entities.map(({ type, raw, value, normalizedValue }) => ({ type, raw, value, normalizedValue })),
      vector.entities,
    );
    for (const entity of entities) {
      assert.equal(vector.text.slice(entity.start, entity.end), entity.raw);
    }
  });
}

test('counts repeated handles once and detects the centralized recipient boundary', () => {
  assert.deepEqual(getUniqueMentionHandles('@Ali @ali @ALI'), ['ali']);
  assert.equal(getUniqueMentionHandles('@one').length, 1);
  const atLimit = Array.from({ length: MENTION_RECIPIENT_LIMIT }, (_, index) => `@user_${index}`).join(' ');
  const overLimit = `${atLimit} @one_more`;
  assert.equal(getUniqueMentionHandles(atLimit).length, MENTION_RECIPIENT_LIMIT);
  assert.equal(getUniqueMentionHandles(overLimit).length, MENTION_RECIPIENT_LIMIT + 1);
});

test('deduplicates hashtag case variants while preserving Unicode display text', () => {
  assert.deepEqual(getUniqueHashtags('#AI #ai #Ai #كرة_القدم'), [
    { normalizedName: 'ai', displayName: 'AI' },
    { normalizedName: 'كرة_القدم', displayName: 'كرة_القدم' },
  ]);
});

test('finds an active composer query but not an email fragment', () => {
  assert.deepEqual(findActiveMentionQuery('Hello (@Ah', 10), { text: 'Ah', index: 7, end: 10 });
  assert.equal(findActiveMentionQuery('ahmad@example', 13), null);
});
