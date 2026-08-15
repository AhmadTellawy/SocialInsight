import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePostMediaScopeFromState, serializePostMediaRecord } from './mediaService';
import { processBase64Image } from '../utils/imageProcessor';

test('resolves draft, group, audience, and account media scopes conservatively', () => {
  assert.equal(resolvePostMediaScopeFromState('DRAFT', [], 'Public', false), 'OWNER_ONLY');
  assert.equal(resolvePostMediaScopeFromState('PUBLISHED', ['group-id'], 'Groups', false), 'INHERITED_GROUP');
  assert.equal(resolvePostMediaScopeFromState('PUBLISHED', [], 'Followers', false), 'RESTRICTED');
  assert.equal(resolvePostMediaScopeFromState('PUBLISHED', [], 'Public', true), 'RESTRICTED');
  assert.equal(resolvePostMediaScopeFromState('PUBLISHED', [], 'Public', false), 'PUBLIC');
});

test('rejects a new arbitrary remote image URL', async () => {
  await assert.rejects(
    () => processBase64Image('https://tracker.example/image.png'),
    (error: any) => error?.code === 'REMOTE_MEDIA_NOT_ALLOWED'
  );
});

test('allows only an exact stored remote value during legacy editing', async () => {
  const existing = 'https://legacy.example/image.png';
  assert.equal(await processBase64Image(existing, existing), existing);
  await assert.rejects(() => processBase64Image(`${existing}?changed=1`, existing));
});

test('suppresses migrated legacy Base64 values from serialized post media', () => {
  const serialized = serializePostMediaRecord({
    id: 'post-id',
    image: 'data:image/png;base64,legacy-post',
    author: { id: 'user-id', name: 'User', avatar: null },
    media: [{
      mediaAsset: {
        id: 'post-media-id',
        accessScope: 'RESTRICTED',
        aspectRatio: 1,
        altText: null,
        variants: [{ kind: 'MEDIUM', isPublic: false, width: 768, height: 768 }]
      }
    }],
    questions: [{
      id: 'question-id',
      image: 'data:image/png;base64,legacy-question',
      imageMediaId: 'question-media-id',
      options: [{ id: 'option-id', image: 'data:image/png;base64,legacy-option', imageMediaId: 'option-media-id' }]
    }]
  });

  const payload = JSON.stringify(serialized);
  assert.equal(payload.includes('data:image/'), false);
  assert.equal(serialized.media[0].id, 'post-media-id');
  assert.equal(serialized.questions[0].imageMediaId, 'question-media-id');
  assert.equal(serialized.questions[0].options[0].imageMediaId, 'option-media-id');
});
