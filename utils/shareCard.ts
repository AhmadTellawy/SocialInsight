import type { MediaPresentation, Option, Survey, SurveyQuestion } from '../types';
import { optionHasImage, resolveOptionPresentation, shouldShowOptionNames } from './optionPresentation.ts';

export const SHARE_CARD_SIZE = 1080;

export type ShareCardPrivacyMode = 'public' | 'restricted';
export type ShareCardAnswerKind = 'rating' | 'text-options' | 'visual-options' | 'open-text' | 'restricted';

export interface ShareCardMediaModel {
  media?: MediaPresentation;
  mediaId?: string;
  fallbackSrc?: string;
  alt: string;
  additionalCount: number;
}

export interface ShareCardOptionModel {
  id: string;
  label: string;
  media?: MediaPresentation;
  mediaId?: string;
  fallbackSrc?: string;
}

export interface ShareCardViewModel {
  postId: string;
  postType: string;
  badge: string;
  privacyMode: ShareCardPrivacyMode;
  privacyReason: 'private' | 'group' | null;
  author: {
    name: string;
    avatarMedia?: MediaPresentation;
    avatarMediaId?: string;
    avatarFallbackSrc?: string;
  };
  createdAt?: string;
  title: string;
  description: string;
  representativeQuestion: string;
  questionCount: number;
  media?: ShareCardMediaModel;
  answerKind: ShareCardAnswerKind;
  options: ShareCardOptionModel[];
  hiddenOptionCount: number;
  totalParticipation: number;
}

const PUBLIC_AUDIENCES = new Set(['', 'public']);
const PUBLIC_VISIBILITIES = new Set(['', 'public']);

const normalizedValue = (value: unknown): string => String(value || '').trim().toLowerCase();

const flattenQuestions = (survey: Survey): SurveyQuestion[] => {
  if (survey.questions?.length) return survey.questions;
  return survey.sections?.flatMap((section) => section.questions || []) || [];
};

const getPrimaryOptions = (survey: Survey, questions: SurveyQuestion[]): Option[] => {
  if (survey.options?.length) return survey.options;
  return questions[0]?.options || [];
};

const hasRestrictedPresentation = (media?: MediaPresentation, mediaId?: string): boolean =>
  media?.access === 'RESTRICTED' || Boolean(mediaId && !media);

const hasRestrictedContentMedia = (survey: Survey, questions: SurveyQuestion[], options: Option[]): boolean => {
  if (survey.media?.some((media) => media.access === 'RESTRICTED')) return true;
  if (questions.some((question) => hasRestrictedPresentation(question.imageMedia, question.imageMediaId))) return true;
  return options.some((option) => hasRestrictedPresentation(option.imageMedia, option.imageMediaId));
};

export const isSafeShareLegacySource = (value: string | null | undefined, currentOrigin: string): boolean => {
  if (!value) return false;
  if (/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\r\n]+$/i.test(value)) return true;
  try {
    const base = new URL(currentOrigin);
    const candidate = new URL(value, base);
    return candidate.origin === base.origin;
  } catch {
    return false;
  }
};

const safeFallback = (value: string | null | undefined, currentOrigin: string): string | undefined =>
  isSafeShareLegacySource(value, currentOrigin) ? value || undefined : undefined;

const resolvePostType = (value: unknown): { postType: string; badge: string } => {
  const raw = String(value || 'Poll').trim();
  const normalized = raw.toLowerCase();
  if (normalized === 'trending') return { postType: 'poll', badge: 'POLL' };
  return { postType: normalized || 'poll', badge: raw.toUpperCase() || 'POLL' };
};

const resolvePrimaryMedia = (
  survey: Survey,
  questions: SurveyQuestion[],
  currentOrigin: string
): ShareCardMediaModel | undefined => {
  const postMedia = survey.media || [];
  if (postMedia.length > 0) {
    const first = postMedia[0];
    return {
      media: first,
      mediaId: first.id,
      alt: first.altText || '',
      additionalCount: Math.max(0, postMedia.length - 1)
    };
  }

  const postFallback = safeFallback(survey.coverImage || survey.image, currentOrigin);
  if (postFallback) {
    return { fallbackSrc: postFallback, alt: '', additionalCount: 0 };
  }

  const question = questions.find((item) => item.imageMedia || item.imageMediaId || item.image);
  if (!question) return undefined;
  const fallbackSrc = safeFallback(question.image, currentOrigin);
  if (!question.imageMedia && !question.imageMediaId && !fallbackSrc) return undefined;
  return {
    media: question.imageMedia,
    mediaId: question.imageMediaId,
    fallbackSrc,
    alt: question.imageMedia?.altText || '',
    additionalCount: 0
  };
};

const mapOption = (option: Option, showLabel: boolean, currentOrigin: string): ShareCardOptionModel => ({
  id: option.id,
  label: showLabel ? option.text.trim() : '',
  media: option.imageMedia,
  mediaId: option.imageMediaId,
  fallbackSrc: safeFallback(option.image, currentOrigin)
});

export const buildShareCardViewModel = (
  survey: Survey,
  currentOrigin: string
): ShareCardViewModel => {
  const source = survey.sharedFrom || survey;
  const questions = flattenQuestions(source);
  const firstQuestion = questions[0];
  const options = getPrimaryOptions(source, questions);
  const { postType, badge } = resolvePostType(source.type);
  const audience = normalizedValue(source.targetAudience);
  const visibility = normalizedValue(source.visibility);
  const groupRestricted = Boolean(source.groupId || source.targetGroups?.length) || audience === 'groups';
  const contentRestricted = !PUBLIC_AUDIENCES.has(audience)
    || !PUBLIC_VISIBILITIES.has(visibility)
    || Boolean(source.author?.isPrivate)
    || groupRestricted
    || hasRestrictedContentMedia(source, questions, options);
  const privacyMode: ShareCardPrivacyMode = contentRestricted ? 'restricted' : 'public';
  const privacyReason = contentRestricted ? (groupRestricted ? 'group' : 'private') : null;

  const publicAvatarMedia = source.author?.avatarMedia?.access === 'PUBLIC'
    ? source.author.avatarMedia
    : undefined;
  const author = {
    name: source.author?.name?.trim() || 'Opiniup member',
    avatarMedia: privacyMode === 'public' ? publicAvatarMedia : undefined,
    avatarMediaId: privacyMode === 'public' && publicAvatarMedia ? source.author.avatarMediaId : undefined,
    avatarFallbackSrc: privacyMode === 'public'
      ? safeFallback(source.author?.avatar, currentOrigin)
      : undefined
  };

  if (privacyMode === 'restricted') {
    return {
      postId: survey.id,
      postType,
      badge,
      privacyMode,
      privacyReason,
      author,
      createdAt: source.createdAt,
      title: '',
      description: '',
      representativeQuestion: '',
      questionCount: 0,
      answerKind: 'restricted',
      options: [],
      hiddenOptionCount: 0,
      totalParticipation: 0
    };
  }

  const media = resolvePrimaryMedia(source, questions, currentOrigin);
  const isRating = source.pollChoiceType === 'rating' || options.some((option) => option.isRating);
  const presentation = resolveOptionPresentation(
    firstQuestion?.optionPresentation || source.optionPresentation,
    options
  );
  const showLabels = shouldShowOptionNames(
    presentation,
    firstQuestion?.showOptionNames ?? source.showOptionNames
  );
  const hasVisualOptions = presentation === 'image' || options.some(optionHasImage);
  const answerKind: ShareCardAnswerKind = isRating
    ? 'rating'
    : options.length > 0
      ? (hasVisualOptions ? 'visual-options' : 'text-options')
      : 'open-text';
  const maxOptions = answerKind === 'visual-options'
    ? 4
    : (media || ['survey', 'quiz'].includes(postType) ? 3 : 4);
  const visibleOptions = options.slice(0, maxOptions).map((option) => mapOption(option, showLabels, currentOrigin));

  return {
    postId: survey.id,
    postType,
    badge,
    privacyMode,
    privacyReason,
    author,
    createdAt: source.createdAt,
    title: source.title?.trim() || source.question?.trim() || '',
    description: source.description?.trim() || '',
    representativeQuestion: ['survey', 'quiz'].includes(postType)
      && firstQuestion?.text?.trim()
      && firstQuestion.text.trim() !== source.title?.trim()
      ? firstQuestion.text.trim()
      : '',
    questionCount: questions.length,
    media,
    answerKind,
    options: visibleOptions,
    hiddenOptionCount: Math.max(0, options.length - visibleOptions.length),
    totalParticipation: Math.max(0, Number(source.participants) || 0)
  };
};

export const formatShareCardDate = (value: string | undefined, locale: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const dateLabel = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
  return `${dateLabel} · ${timeLabel}`;
};

export const resolveCanonicalOrigin = (configuredOrigin: string | undefined, runtimeOrigin: string): string => {
  for (const candidate of [configuredOrigin, runtimeOrigin]) {
    if (!candidate) continue;
    try {
      return new URL(candidate).origin;
    } catch {
      // Try the next configured source.
    }
  }
  return runtimeOrigin;
};

export const buildCanonicalPostUrl = (postId: string, canonicalOrigin: string): string =>
  `${canonicalOrigin.replace(/\/$/, '')}/post/${encodeURIComponent(postId)}`;

export const getCanonicalHost = (canonicalOrigin: string): string => {
  try {
    return new URL(canonicalOrigin).host;
  } catch {
    return canonicalOrigin.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
};
