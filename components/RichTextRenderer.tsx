import React from 'react';
import { useNavigate } from 'react-router-dom';
import { parseTextEntities, TextEntity } from '../utils/textEntities';
import { Analytics } from '../utils/analytics';
import { useTranslation } from 'react-i18next';

export interface MentionOccurrenceReference {
  surface: string;
  startOffset: number;
  endOffset: number;
  rawText: string;
}

export interface MentionReference {
  id: string;
  targetUserId: string;
  sourceType: string;
  targetUser?: {
    id: string;
    name?: string;
    handle?: string;
  };
  occurrences: MentionOccurrenceReference[];
}

interface RichTextRendererProps {
  text: string;
  className?: string;
  inline?: boolean;
  mentions?: MentionReference[] | null;
  mentionSurface?: string;
  onUserClick?: (handle: string, userId?: string) => void;
  onHashtagClick?: (tag: string) => void;
  analyticsSurface?: 'PROFILE' | 'SEARCH' | 'DEEP_LINK' | 'TOPIC';
}

const findMentionReference = (
  entity: TextEntity,
  mentions: MentionReference[] | null | undefined,
  mentionSurface?: string
): MentionReference | undefined => mentions?.find((mention) =>
  mention.occurrences?.some((occurrence) =>
    (!mentionSurface || occurrence.surface === mentionSurface)
    && occurrence.startOffset === entity.start
    && occurrence.endOffset === entity.end
    && occurrence.rawText === entity.raw
  )
);

export const RichTextRenderer: React.FC<RichTextRendererProps> = ({
  text,
  className = '',
  inline = false,
  mentions,
  mentionSurface,
  onUserClick,
  onHashtagClick,
  analyticsSurface = 'DEEP_LINK'
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  if (!text) return null;

  const entities = parseTextEntities(text);
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  entities.forEach((entity) => {
    if (entity.start > cursor) {
      parts.push(<span key={`text-${cursor}`}>{text.slice(cursor, entity.start)}</span>);
    }

    if (entity.type === 'mention') {
      const mention = findMentionReference(entity, mentions, mentionSurface);
      if (!mention?.targetUserId) {
        parts.push(<span key={`mention-text-${entity.start}`}>{entity.raw}</span>);
      } else {
        const currentHandle = mention.targetUser?.handle || entity.normalizedValue;
        const profileHref = `/profile/${encodeURIComponent(mention.targetUserId)}`;
        parts.push(
          <a
            key={`mention-${mention.id}-${entity.start}`}
            href={profileHref}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              Analytics.track({
                event_type: 'MENTION_PROFILE_OPENED',
                target_user_id: mention.targetUserId,
                source_surface: analyticsSurface
              });
              if (onUserClick) onUserClick(currentHandle, mention.targetUserId);
              else navigate(profileHref);
            }}
            className="text-blue-600 font-semibold transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded-sm"
            aria-label={t('mentions.viewProfile', { handle: currentHandle })}
          >
            {entity.raw}
          </a>
        );
      }
    } else {
      const topicHref = `/hashtag/${encodeURIComponent(entity.normalizedValue)}`;
      parts.push(
        <a
          key={`hashtag-${entity.start}`}
          href={topicHref}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            Analytics.track({
              event_type: 'HASHTAG_CLICKED',
              source_surface: analyticsSurface
            });
            if (onHashtagClick) onHashtagClick(entity.value);
            else navigate(topicHref);
          }}
          className="text-blue-600 font-semibold transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded-sm"
          aria-label={t('hashtags.viewTopic', { tag: entity.value })}
        >
          {entity.raw}
        </a>
      );
    }

    cursor = entity.end;
  });

  if (cursor < text.length) {
    parts.push(<span key={`text-${cursor}`}>{text.slice(cursor)}</span>);
  }

  return (
    <span className={`${inline ? 'inline' : ''} whitespace-pre-wrap break-words ${className}`}>
      {parts}
    </span>
  );
};
