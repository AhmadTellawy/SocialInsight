import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
    MENTION_RECIPIENT_LIMIT,
    getUniqueMentionHandles,
    parseTextEntities
} from './textEntities';

interface TestVector {
    name: string;
    text: string;
    entities: Array<{ type: string; raw: string; value: string; normalizedValue: string }>;
}

const vectors = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../../shared/textEntityTestVectors.json'),
    'utf8'
)) as TestVector[];

for (const vector of vectors) {
    test(`server tokenizer: ${vector.name}`, () => {
        const entities = parseTextEntities(vector.text);
        assert.deepEqual(
            entities.map(({ type, raw, value, normalizedValue }) => ({ type, raw, value, normalizedValue })),
            vector.entities
        );
        for (const entity of entities) {
            assert.equal(vector.text.slice(entity.start, entity.end), entity.raw);
        }
    });
}

test('server recipient counting is unique and capped by the shared constant', () => {
    assert.deepEqual(getUniqueMentionHandles('@Ali @ali @ALI'), ['ali']);
    assert.equal(getUniqueMentionHandles('@one').length, 1);
    const handles = Array.from({ length: MENTION_RECIPIENT_LIMIT + 1 }, (_, index) => `@user_${index}`).join(' ');
    assert.equal(getUniqueMentionHandles(handles).length, MENTION_RECIPIENT_LIMIT + 1);
});
