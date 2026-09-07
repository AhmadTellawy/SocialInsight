import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePostMediaScopeFromState, serializeMediaAsset, serializePostMediaRecord, serializeUserMediaRecord } from './mediaService';
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

test('redacts hidden image-option labels for viewers but preserves them for the creator', () => {
  const post = {
    id: 'post-id',
    status: 'PUBLISHED',
    authorId: 'creator-id',
    optionPresentation: 'image',
    showOptionNames: false,
    questions: [{
      id: 'question-id',
      options: [{ id: 'option-id', text: 'Internal option name', image: 'https://example.com/option.webp' }]
    }],
    sections: [{
      id: 'section-id',
      questions: [{
        id: 'section-question-id',
        optionPresentation: 'image',
        showOptionNames: false,
        options: [{
          id: 'section-option-id',
          text: 'Internal section option name',
          imageMedia: {
            id: 'media-id',
            accessScope: 'RESTRICTED',
            aspectRatio: 1,
            altText: 'Internal section option name',
            variants: [{ kind: 'SMALL', isPublic: false, width: 100, height: 100 }]
          }
        }]
      }]
    }]
  };

  const publicPost = serializePostMediaRecord(post, 'viewer-id');
  const creatorPost = serializePostMediaRecord(post, 'creator-id');

  assert.equal(publicPost.questions[0].options[0].text, '');
  assert.equal(publicPost.sections[0].questions[0].options[0].text, '');
  assert.equal(publicPost.sections[0].questions[0].options[0].imageMedia.altText, null);
  assert.equal(creatorPost.questions[0].options[0].text, 'Internal option name');
  assert.equal(creatorPost.sections[0].questions[0].options[0].text, 'Internal section option name');
});

test('serializes the focal point relative to the creator crop', () => {
  const presentation = serializeMediaAsset({
    id: 'media-id',
    accessScope: 'RESTRICTED',
    aspectRatio: 1,
    altText: null,
    cropX: 0.2,
    cropY: 0.1,
    cropWidth: 0.5,
    cropHeight: 0.5,
    focalX: 0.65,
    focalY: 0.2,
    variants: [{ kind: 'MEDIUM', isPublic: false, width: 768, height: 768 }]
  } as any);

  assert.ok(presentation);
  assert.equal(presentation.focalX, 0.9);
  assert.equal(presentation.focalY, 0.2);
});

test('legacy avatars require proven public active ownership and restricted avatars never retain public URLs', () => {
  const avatar = 'https://legacy.example/private.webp';
  for (const user of [{ avatar }, { avatar, status: 'DEACTIVATED', isPrivate: false }, { avatar, status: 'ACTIVE', isPrivate: true }, { avatar, status: 'ACTIVE', isPrivate: false, mediaPrivacyTarget: true }]) {
    assert.equal(serializeUserMediaRecord(user)!.avatar, '');
  }
  assert.equal(serializeUserMediaRecord({ avatar, status: 'ACTIVE', isPrivate: false, mediaPrivacyTarget: null })!.avatar, avatar);
  const serialized = serializeUserMediaRecord({ avatar, avatarMediaId: 'avatar-id', avatarMedia: { id: 'avatar-id', accessScope: 'RESTRICTED', aspectRatio: 1, altText: null, owner: { status: 'ACTIVE', isPrivate: true }, variants: [{ kind: 'SMALL', isPublic: false, width: 100, height: 100 }] } });
  assert.equal(serialized!.avatar, '');
  assert.equal((serialized!.avatarMedia as any).access, 'RESTRICTED');
  assert.equal(JSON.stringify(serialized).includes(avatar), false);
});

test('post author cards omit private biography and location while retaining follow state', () => {
  const post = serializePostMediaRecord({ author: { id: 'private-person', name: 'Private Person', handle: 'private_person', status: 'ACTIVE', isPrivate: true,
    bio: 'Private biography', location: 'Private location', website: 'https://private.example', country: 'Jordan', following: [{ followerId: 'viewer' }],
    avatarMediaId: 'private-photo', avatarMedia: { id: 'private-photo', accessScope: 'RESTRICTED', aspectRatio: 1, altText: 'Private photo description', owner: { status: 'ACTIVE', isPrivate: true }, variants: [{ kind: 'SMALL', isPublic: false, width: 100, height: 100 }] } } });
  for (const key of ['bio', 'location', 'website', 'country', 'status']) assert.equal(key in post.author, false);
  assert.equal(post.author.avatarMedia.altText, null);
  assert.equal(post.author.following.length, 1);
  assert.equal(JSON.stringify(post).includes('followerId'), false);
});
