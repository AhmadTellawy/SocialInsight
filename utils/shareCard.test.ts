import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { Survey } from '../types.ts';
import {
  SHARE_CARD_SIZE,
  buildCanonicalPostUrl,
  buildShareCardViewModel,
  formatShareCardDate,
  getCanonicalHost,
  isSafeShareLegacySource,
  resolveCanonicalOrigin
} from './shareCard.ts';

const origin = 'https://opiniup.com';

const createSurvey = (overrides: Partial<Survey> = {}): Survey => ({
  id: 'post-id',
  title: 'Which option do you prefer?',
  description: 'A concise description.',
  type: 'Poll' as Survey['type'],
  options: [
    { id: 'one', text: 'Option one', votes: 4 },
    { id: 'two', text: 'Option two', votes: 2 }
  ],
  participants: 6,
  isTrending: false,
  status: 'PUBLISHED',
  createdAt: '2026-08-20T07:43:00.000Z',
  author: {
    id: 'author-id',
    name: 'Ahmad Tellawy',
    avatar: '',
    isPrivate: false
  },
  likes: 20,
  commentsCount: 10,
  targetAudience: 'Public',
  ...overrides
});

test('uses a fixed square output contract and canonical post URL', () => {
  assert.equal(SHARE_CARD_SIZE, 1080);
  const canonicalOrigin = resolveCanonicalOrigin(origin, 'http://127.0.0.1:5173');
  assert.equal(buildCanonicalPostUrl('post/id', canonicalOrigin), `${origin}/post/post%2Fid`);
  assert.equal(getCanonicalHost(canonicalOrigin), 'opiniup.com');
});

test('maps a public poll without engagement counts or viewer-specific state', () => {
  const model = buildShareCardViewModel(createSurvey({
    userSelectedOptions: ['one'],
    hasParticipated: true,
    likes: 99,
    commentsCount: 44,
    repostCount: 12,
    options: [
      { id: 'one', text: 'One', votes: 4 },
      { id: 'two', text: 'Two', votes: 3 },
      { id: 'three', text: 'Three', votes: 2 },
      { id: 'four', text: 'Four', votes: 1 },
      { id: 'five', text: 'Five', votes: 0 }
    ]
  }), origin);

  assert.equal(model.privacyMode, 'public');
  assert.equal(model.answerKind, 'text-options');
  assert.equal(model.options.length, 4);
  assert.equal(model.hiddenOptionCount, 1);
  assert.equal(model.totalParticipation, 6);
  assert.equal(JSON.stringify(model).includes('userSelectedOptions'), false);
  assert.equal(JSON.stringify(model).includes('commentsCount'), false);
});

test('uses the Opiniup member fallback without changing supplied author names', () => {
  const unnamed = createSurvey({ author: { id: 'author-id', name: '   ', avatar: '', isPrivate: false } });
  assert.equal(buildShareCardViewModel(unnamed, origin).author.name, 'Opiniup member');
  assert.equal(buildShareCardViewModel(createSurvey(), origin).author.name, 'Ahmad Tellawy');
});

test('uses Opiniup share copy in Arabic and English with the existing interpolation contract', () => {
  for (const locale of ['ar', 'en']) {
    const translations = JSON.parse(readFileSync(new URL(`../locales/${locale}/translation.json`, import.meta.url), 'utf8'));
    assert.match(translations.shareCard.openToView, /Opiniup/);
    assert.match(translations.shareCard.shareText, /Opiniup/);
    assert.match(translations.shareCard.shareText, /\{\{type\}\}/);
    assert.doesNotMatch(translations.shareCard.openToView + translations.shareCard.shareText, /Social\s?Insight/i);
  }
});

test('keeps share destinations environment-derived rather than forcing the new domain', () => {
  const previewOrigin = 'https://preview.example.test';
  assert.equal(resolveCanonicalOrigin(undefined, previewOrigin), previewOrigin);
  assert.equal(buildCanonicalPostUrl('post-id', previewOrigin), `${previewOrigin}/post/post-id`);
});

test('uses a neutral rating representation', () => {
  const model = buildShareCardViewModel(createSurvey({
    pollChoiceType: 'rating',
    options: Array.from({ length: 5 }, (_, index) => ({
      id: String(index + 1),
      text: `${index + 1} stars`,
      votes: index,
      isRating: true,
      ratingValue: index + 1
    }))
  }), origin);
  assert.equal(model.answerKind, 'rating');
  assert.equal(model.options.length, 4);
  assert.equal(JSON.stringify(model).includes('ratingValue'), false);
});

test('redacts voter-hidden visual option labels', () => {
  const publicImage = {
    id: 'media-id',
    access: 'PUBLIC' as const,
    aspectRatio: 1,
    width: 640,
    height: 640,
    src: 'https://cdn.example.com/image.webp'
  };
  const model = buildShareCardViewModel(createSurvey({
    optionPresentation: 'image',
    showOptionNames: false,
    options: [
      { id: 'one', text: 'Internal analytics name', votes: 0, imageMedia: publicImage, imageMediaId: publicImage.id },
      { id: 'two', text: 'Another internal name', votes: 0, imageMedia: { ...publicImage, id: 'media-two' }, imageMediaId: 'media-two' }
    ]
  }), origin);
  assert.equal(model.answerKind, 'visual-options');
  assert.deepEqual(model.options.map((option) => option.label), ['', '']);
  assert.equal(JSON.stringify(model).includes('Internal analytics name'), false);
});

test('never carries quiz correctness into the share model', () => {
  const model = buildShareCardViewModel(createSurvey({
    type: 'Quiz' as Survey['type'],
    options: [],
    questions: [{
      id: 'question-id',
      text: 'What is the answer?',
      type: 'multiple_choice',
      correctOptionId: 'correct',
      options: [
        { id: 'correct', text: 'Correct secret', votes: 10, isCorrect: true },
        { id: 'wrong', text: 'Other answer', votes: 2, isCorrect: false }
      ]
    }]
  }), origin);
  assert.equal(model.postType, 'quiz');
  assert.equal(model.representativeQuestion, 'What is the answer?');
  assert.equal(JSON.stringify(model).includes('isCorrect'), false);
  assert.equal(JSON.stringify(model).includes('correctOptionId'), false);
});

test('summarizes multi-question surveys instead of serializing the full questionnaire', () => {
  const model = buildShareCardViewModel(createSurvey({
    type: 'Survey' as Survey['type'],
    options: [],
    questions: [
      { id: 'q1', text: 'First question', type: 'text' },
      { id: 'q2', text: 'Second question', type: 'text' },
      { id: 'q3', text: 'Third question', type: 'text' }
    ]
  }), origin);
  assert.equal(model.questionCount, 3);
  assert.equal(model.representativeQuestion, 'First question');
  assert.equal(model.answerKind, 'open-text');
  assert.equal(JSON.stringify(model).includes('Second question'), false);
});

test('uses a content-free representation for private, follower, and group posts', () => {
  for (const survey of [
    createSurvey({ targetAudience: 'Followers', coverImage: '/private.webp' }),
    createSurvey({ targetAudience: 'Groups', groupId: 'group-id' }),
    createSurvey({ author: { id: 'private-author', name: 'Private Author', avatar: '', isPrivate: true } })
  ]) {
    const model = buildShareCardViewModel(survey, origin);
    assert.equal(model.privacyMode, 'restricted');
    assert.equal(model.title, '');
    assert.equal(model.description, '');
    assert.equal(model.media, undefined);
    assert.deepEqual(model.options, []);
    assert.equal(model.totalParticipation, 0);
  }
});

test('keeps unknown legacy post types safe through the generic renderer', () => {
  const model = buildShareCardViewModel(createSurvey({ type: 'Debate' as Survey['type'] }), origin);
  assert.equal(model.postType, 'debate');
  assert.equal(model.badge, 'DEBATE');
  assert.equal(model.answerKind, 'text-options');
});

test('formats an absolute localized date without relative time', () => {
  const formatted = formatShareCardDate('2026-08-20T07:43:00.000Z', 'en');
  assert.match(formatted, /2026/);
  assert.equal(/ago/i.test(formatted), false);
});

test('allows only same-origin or bounded data legacy images for capture', () => {
  assert.equal(isSafeShareLegacySource('/uploads/image.webp', origin), true);
  assert.equal(isSafeShareLegacySource(`${origin}/image.webp`, origin), true);
  assert.equal(isSafeShareLegacySource('data:image/png;base64,AAAA', origin), true);
  assert.equal(isSafeShareLegacySource('https://tracker.example/image.webp', origin), false);
  assert.equal(isSafeShareLegacySource('javascript:alert(1)', origin), false);
});
