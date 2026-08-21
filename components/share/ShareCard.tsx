import React, { useState } from 'react';
import {
  BarChart3,
  Circle,
  FileText,
  Globe,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Repeat,
  Share2,
  Star,
  ThumbsUp
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UserAvatar } from '../UserAvatar';
import { MediaImage } from '../media/MediaImage';
import {
  SHARE_CARD_SIZE,
  ShareCardMediaModel,
  ShareCardOptionModel,
  ShareCardViewModel,
  formatShareCardDate
} from '../../utils/shareCard';

interface ShareCardProps {
  model: ShareCardViewModel;
  canonicalHost: string;
}

const typeBadgeClass = (postType: string): string => {
  switch (postType) {
    case 'poll': return 'border-green-200 bg-green-50 text-green-700';
    case 'quiz': return 'border-purple-200 bg-purple-50 text-purple-700';
    case 'challenge': return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'survey': return 'border-blue-200 bg-blue-50 text-blue-700';
    default: return 'border-gray-200 bg-gray-50 text-gray-700';
  }
};

export const ShareBrandHeader: React.FC<{ canonicalHost: string }> = ({ canonicalHost }) => (
  <header dir="ltr" className="flex h-[104px] shrink-0 items-center justify-between border-b border-gray-200 px-12">
    <div className="flex min-w-0 items-center gap-4">
      <img
        src="/logo.png"
        alt=""
        aria-hidden="true"
        className="h-[54px] w-[54px] shrink-0 object-contain"
        loading="eager"
        fetchPriority="high"
      />
      <span className="text-[30px] font-semibold text-[#102a43]">SocialInsight</span>
    </div>
    <span data-testid="share-card-domain" className="max-w-[390px] truncate text-right text-[22px] font-medium text-gray-500">{canonicalHost}</span>
  </header>
);

export const ShareAuthorHeader: React.FC<{ model: ShareCardViewModel; locale: string }> = ({ model, locale }) => {
  const { t } = useTranslation();
  const dateLabel = formatShareCardDate(model.createdAt, locale);
  const VisibilityIcon = model.privacyMode === 'restricted' ? Lock : Globe;
  return (
    <div className="flex h-[82px] shrink-0 items-start gap-4">
      <UserAvatar
        media={model.author.avatarMedia}
        mediaId={model.author.avatarMediaId}
        src={model.author.avatarFallbackSrc}
        name={model.author.name}
        alt={model.author.name}
        size={72}
        className="border border-gray-200 bg-white"
      />
      <div className="min-w-0 flex-1 pt-0.5">
        <div dir="auto" className="truncate text-[27px] font-semibold leading-tight text-gray-900">{model.author.name}</div>
        <div className="mt-2 flex min-w-0 items-center gap-2.5 text-[19px] font-medium text-gray-500">
          {dateLabel && <span data-testid="share-card-date" className="truncate tabular-nums">{dateLabel}</span>}
          {dateLabel && <span className="text-gray-300">·</span>}
          <VisibilityIcon size={20} strokeWidth={1.8} className="shrink-0 text-gray-500" aria-hidden="true" />
          <span className="text-gray-300">·</span>
          <span className={`shrink-0 rounded-md border px-2.5 py-1 text-[16px] font-bold leading-none ${typeBadgeClass(model.postType)}`}>
            {t(model.badge, { defaultValue: model.badge })}
          </span>
        </div>
      </div>
      <MoreHorizontal size={30} strokeWidth={1.8} className="mt-1 shrink-0 text-gray-400" aria-hidden="true" />
    </div>
  );
};

const ShareMediaPreview: React.FC<{ media: ShareCardMediaModel; answerKind: ShareCardViewModel['answerKind'] }> = ({ media, answerKind }) => {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const flexible = answerKind === 'rating';
  const heightClass = answerKind === 'visual-options'
    ? 'h-[118px]'
    : answerKind === 'text-options'
      ? 'h-[170px]'
      : answerKind === 'rating'
        ? 'min-h-[280px] flex-1'
        : 'h-[300px]';
  return (
    <div
      data-testid="share-card-media"
      className={`relative w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50 ${flexible ? '' : 'shrink-0'} ${heightClass}`}
    >
      <MediaImage
        media={media.media}
        mediaId={media.mediaId}
        fallbackSrc={media.fallbackSrc}
        alt={media.alt}
        eager
        useFocalPoint
        onUnavailable={() => setFailed(true)}
        className="h-full w-full object-cover"
        sizes="984px"
      />
      {media.additionalCount > 0 && (
        <div className="absolute bottom-4 right-4 rounded-md bg-black/70 px-3 py-1.5 text-[19px] font-semibold text-white" dir="ltr">
          +{media.additionalCount}
        </div>
      )}
    </div>
  );
};

const ShareVisualOption: React.FC<{ option: ShareCardOptionModel; compact: boolean; index: number }> = ({ option, compact, index }) => {
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(option.media || option.mediaId || option.fallbackSrc);
  if (failed && !option.label) return null;
  if (failed || !hasImage) {
    return (
      <div className="flex min-h-[70px] items-center gap-3 rounded-lg border border-gray-200 px-4 py-3">
        <Circle size={20} strokeWidth={1.8} className="shrink-0 text-gray-400" aria-hidden="true" />
        <span dir="auto" className="line-clamp-2 text-[22px] font-medium leading-snug text-gray-800">{option.label}</span>
      </div>
    );
  }
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className={`overflow-hidden bg-gray-50 ${compact ? 'h-[90px]' : 'h-[156px]'}`}>
        <MediaImage
          media={option.media}
          mediaId={option.mediaId}
          fallbackSrc={option.fallbackSrc}
          alt=""
          eager
          useFocalPoint
          onUnavailable={() => setFailed(true)}
          className="h-full w-full object-cover"
          sizes="470px"
        />
      </div>
      {option.label && (
        <div dir="auto" className="line-clamp-1 border-t border-gray-100 px-3 py-2 text-[20px] font-medium leading-snug text-gray-800">
          {option.label}
        </div>
      )}
      {!option.label && <span className="sr-only">Option {index + 1}</span>}
    </div>
  );
};

const RepresentativeQuestion: React.FC<{ model: ShareCardViewModel }> = ({ model }) => {
  const { t } = useTranslation();
  if (!model.representativeQuestion && model.questionCount <= 1) return null;
  return (
    <div className="mb-3 flex shrink-0 items-start justify-between gap-5 rounded-lg bg-gray-50 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <FileText size={23} strokeWidth={1.8} className="mt-0.5 shrink-0 text-blue-600" aria-hidden="true" />
        {model.representativeQuestion && (
          <p dir="auto" className="line-clamp-2 text-[22px] font-medium leading-snug text-gray-800">{model.representativeQuestion}</p>
        )}
      </div>
      {model.questionCount > 1 && (
        <span className="shrink-0 text-[18px] font-semibold text-gray-500">
          {t('shareCard.questions', { count: model.questionCount })}
        </span>
      )}
    </div>
  );
};

export const ShareAnswerPreview: React.FC<{ model: ShareCardViewModel; hasMedia: boolean }> = ({ model, hasMedia }) => {
  const { t } = useTranslation();
  if (model.answerKind === 'restricted') return null;

  if (model.answerKind === 'rating') {
    return (
      <div data-share-answer-kind="rating" className="flex min-h-[98px] shrink-0 items-center justify-between gap-6 rounded-lg border border-gray-200 px-6 py-5">
        <span className="text-[23px] font-medium text-gray-700">{t('shareCard.ratePrompt')}</span>
        <div dir="ltr" className="flex shrink-0 items-center gap-2 text-amber-400">
          {Array.from({ length: 5 }).map((_, index) => (
            <Star key={index} size={45} strokeWidth={1.8} aria-hidden="true" />
          ))}
        </div>
      </div>
    );
  }

  if (model.answerKind === 'visual-options') {
    return (
      <div data-share-answer-kind="visual-options" className="min-h-0 flex-1">
        <RepresentativeQuestion model={model} />
        <div className="grid grid-cols-2 gap-3.5">
          {model.options.map((option, index) => (
            <ShareVisualOption key={option.id} option={option} compact={hasMedia || Boolean(model.representativeQuestion)} index={index} />
          ))}
        </div>
        {model.hiddenOptionCount > 0 && (
          <div className="mt-3 text-center text-[19px] font-semibold text-gray-500">
            {t('shareCard.moreOptions', { count: model.hiddenOptionCount })}
          </div>
        )}
      </div>
    );
  }

  if (model.answerKind === 'text-options') {
    return (
      <div data-share-answer-kind="text-options" className="min-h-0 flex-1">
        <RepresentativeQuestion model={model} />
        <div className="space-y-3">
          {model.options.map((option) => (
            <div key={option.id} className="flex min-h-[64px] items-center gap-4 rounded-lg border border-gray-200 px-5 py-3">
              <Circle size={22} strokeWidth={1.8} className="shrink-0 text-gray-400" aria-hidden="true" />
              <span dir="auto" className="line-clamp-2 text-[23px] font-normal leading-snug text-gray-800">{option.label}</span>
            </div>
          ))}
        </div>
        {model.hiddenOptionCount > 0 && (
          <div className="mt-3 text-center text-[19px] font-semibold text-gray-500">
            {t('shareCard.moreOptions', { count: model.hiddenOptionCount })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-share-answer-kind="open-text" className="min-h-0 flex-1">
      <RepresentativeQuestion model={model} />
      <div className="flex min-h-[82px] items-center gap-4 rounded-lg border border-gray-200 px-5 py-4 text-gray-600">
        <MessageCircle size={26} strokeWidth={1.8} className="shrink-0 text-blue-600" aria-hidden="true" />
        <span className="text-[22px] font-medium">{t('shareCard.openResponse')}</span>
      </div>
    </div>
  );
};

export const ShareActionFooter: React.FC = () => {
  const icons = [ThumbsUp, MessageCircle, Repeat, Share2, BarChart3];
  return (
    <footer dir="ltr" data-testid="share-card-actions" className="flex h-[98px] shrink-0 items-center justify-around border-t border-gray-200 px-12 text-gray-500">
      {icons.map((Icon, index) => <Icon key={index} size={31} strokeWidth={1.8} aria-hidden="true" />)}
    </footer>
  );
};

const RestrictedContent: React.FC<{ model: ShareCardViewModel }> = ({ model }) => {
  const { t } = useTranslation();
  return (
    <div data-testid="share-card-restricted" className="flex min-h-0 flex-1 flex-col items-center justify-center px-16 text-center">
      <div className="mb-7 flex h-[92px] w-[92px] items-center justify-center rounded-full bg-blue-50 text-blue-700">
        <Lock size={42} strokeWidth={1.8} aria-hidden="true" />
      </div>
      <p dir="auto" className="max-w-[760px] text-[32px] font-normal leading-snug text-gray-900">
        {t(model.privacyReason === 'group' ? 'shareCard.restrictedGroupPost' : 'shareCard.privatePost', { author: model.author.name })}
      </p>
      <p className="mt-4 text-[23px] font-normal text-gray-500">{t('shareCard.openToView')}</p>
    </div>
  );
};

export const ShareCard: React.FC<ShareCardProps> = ({ model, canonicalHost }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const direction = i18n.dir(locale);
  const hasMedia = Boolean(model.media);
  const denseContent = Boolean(model.media) || model.answerKind === 'visual-options';
  const participationKey = ['poll', 'challenge', 'prediction', 'debate'].includes(model.postType)
    ? 'shareCard.votes'
    : 'shareCard.responses';
  const formattedParticipation = new Intl.NumberFormat(locale).format(model.totalParticipation);

  return (
    <article
      data-testid="share-card"
      data-share-privacy={model.privacyMode}
      data-share-post-type={model.postType}
      dir={direction}
      className="relative flex overflow-hidden bg-white text-gray-900"
      style={{ width: SHARE_CARD_SIZE, height: SHARE_CARD_SIZE, flexDirection: 'column' }}
    >
      <div className="h-2 shrink-0 bg-gradient-to-r from-blue-600 to-emerald-500" />
      <ShareBrandHeader canonicalHost={canonicalHost} />

      <main className="flex min-h-0 flex-1 flex-col px-12 pb-5 pt-7">
        <ShareAuthorHeader model={model} locale={locale} />
        {model.privacyMode === 'restricted' ? (
          <RestrictedContent model={model} />
        ) : (
          <>
            <section className="mt-5 shrink-0">
              <h1 dir="auto" className={`${denseContent ? 'line-clamp-3' : 'line-clamp-4'} whitespace-pre-wrap text-[30px] font-normal leading-[1.35] text-gray-900`}>
                {model.title}
              </h1>
              {model.description && (
                <p dir="auto" className={`mt-2 ${denseContent ? 'line-clamp-1' : 'line-clamp-2'} whitespace-pre-wrap text-[22px] font-normal leading-[1.4] text-gray-600`}>
                  {model.description}
                </p>
              )}
            </section>

            <section className="mt-5 flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
              {model.media && <ShareMediaPreview media={model.media} answerKind={model.answerKind} />}
              <ShareAnswerPreview model={model} hasMedia={hasMedia} />
            </section>

            <div data-testid="share-card-participation" className="mt-4 flex h-[42px] shrink-0 items-center text-[21px] font-semibold text-gray-600">
              {t(participationKey, { count: model.totalParticipation, formattedCount: formattedParticipation })}
            </div>
          </>
        )}
      </main>

      <ShareActionFooter />
      <div className="h-2 shrink-0 bg-gradient-to-r from-blue-600 to-emerald-500" />
    </article>
  );
};
