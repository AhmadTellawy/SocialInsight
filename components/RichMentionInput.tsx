import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { createMentionSearchScheduler, MentionSearchScheduler } from '../utils/mentionAutocomplete';
import {
  ActiveMentionQuery,
  findActiveMentionQuery,
  getUniqueMentionHandles,
  MENTION_RECIPIENT_LIMIT
} from '../utils/textEntities';
import { UserAvatar } from './UserAvatar';
import { Analytics } from '../utils/analytics';

interface MentionSuggestion {
  id: string;
  name?: string;
  handle: string;
  avatar?: string | null;
  avatarMediaId?: string | null;
  avatarMedia?: any;
}

interface RichMentionInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  ariaLabel?: string;
}

export const RichMentionInput: React.FC<RichMentionInputProps> = ({
  value,
  onChange,
  placeholder,
  className = '',
  minRows = 3,
  autoFocus = false,
  onKeyDown,
  ariaLabel
}) => {
  const { t } = useTranslation();
  const [mentionQuery, setMentionQuery] = useState<ActiveMentionQuery | null>(null);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [placement, setPlacement] = useState<'above' | 'below'>('above');
  const [dropdownMaxHeight, setDropdownMaxHeight] = useState(224);
  const [announcement, setAnnouncement] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchSchedulerRef = useRef<MentionSearchScheduler<MentionSuggestion> | null>(null);
  const suggestionSessionOpenRef = useRef(false);
  const listboxId = `mention-listbox-${useId().replace(/:/g, '')}`;

  if (!searchSchedulerRef.current) {
    searchSchedulerRef.current = createMentionSearchScheduler((query, signal) => api.searchUsers(query, signal));
  }

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.max(textareaRef.current.scrollHeight, minRows * 24)}px`;
  }, [value, minRows]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const scheduler = searchSchedulerRef.current!;
    scheduler.cancel();
    setSuggestions([]);
    setHighlightedIndex(-1);
    setSearchFailed(false);

    if (!mentionQuery) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    scheduler.schedule(mentionQuery.text, {
      onSuccess: (results) => {
        const nextSuggestions = results || [];
        setSuggestions(nextSuggestions);
        setHighlightedIndex(nextSuggestions.length > 0 ? 0 : -1);
        setAnnouncement(nextSuggestions.length > 0
          ? t('mentions.suggestionCount', { count: nextSuggestions.length })
          : t('mentions.noUsersFound'));
      },
      onError: () => {
        setSearchFailed(true);
        setAnnouncement(t('mentions.searchFailed'));
      },
      onSettled: () => setIsLoading(false)
    });

    return () => scheduler.cancel();
  }, [mentionQuery?.text, t]);

  useEffect(() => {
    if (!mentionQuery) return;

    const updatePlacement = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const rect = textarea.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const roomBelow = viewportHeight - rect.bottom;
      const roomAbove = rect.top;
      const nextPlacement = roomBelow >= 220 || roomBelow >= roomAbove ? 'below' : 'above';
      const availableRoom = nextPlacement === 'below' ? roomBelow : roomAbove;
      setPlacement(nextPlacement);
      setDropdownMaxHeight(Math.max(48, Math.min(224, availableRoom - 12)));
    };

    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    window.visualViewport?.addEventListener('resize', updatePlacement);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
      window.visualViewport?.removeEventListener('resize', updatePlacement);
    };
  }, [mentionQuery]);

  const updateMentionQuery = (text: string, cursor: number) => {
    const nextQuery = findActiveMentionQuery(text, cursor);
    if (nextQuery && !suggestionSessionOpenRef.current) {
      suggestionSessionOpenRef.current = true;
      Analytics.track({
        event_type: 'MENTION_SUGGESTION_OPENED',
        source_surface: 'COMPOSER'
      });
    } else if (!nextQuery) {
      suggestionSessionOpenRef.current = false;
    }
    setMentionQuery(nextQuery);
  };

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;
    onChange(text);
    updateMentionQuery(text, event.target.selectionStart);
  };

  const closeSuggestions = () => {
    suggestionSessionOpenRef.current = false;
    setMentionQuery(null);
    setSuggestions([]);
    setHighlightedIndex(-1);
    setIsLoading(false);
  };

  const insertMention = (user: MentionSuggestion) => {
    if (!mentionQuery) return;

    const textBeforeMention = value.substring(0, mentionQuery.index);
    const textAfterMentionCursor = value.substring(mentionQuery.end);
    const insertedMention = `@${user.handle}`;
    const needsTrailingSpace = textAfterMentionCursor.length === 0 || !/^\s/.test(textAfterMentionCursor);
    const newText = `${textBeforeMention}${insertedMention}${needsTrailingSpace ? ' ' : ''}${textAfterMentionCursor}`;

    if (getUniqueMentionHandles(newText).length > MENTION_RECIPIENT_LIMIT) {
      setAnnouncement(t('mentions.limitExceeded', { limit: MENTION_RECIPIENT_LIMIT }));
      return;
    }

    const nextCursor = textBeforeMention.length + insertedMention.length + (needsTrailingSpace ? 1 : 0);
    onChange(newText);
    Analytics.track({
      event_type: 'MENTION_SELECTED',
      target_user_id: user.id,
      source_surface: 'COMPOSER'
    });
    closeSuggestions();
    setAnnouncement(t('mentions.selected', { handle: user.handle }));

    textareaRef.current?.focus({ preventScroll: true });
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(nextCursor, nextCursor));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isOpen = mentionQuery !== null;
    if (isOpen && event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault();
      setHighlightedIndex((current) => (current + 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (isOpen && event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault();
      setHighlightedIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (isOpen && event.key === 'Enter' && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
      event.preventDefault();
      insertMention(suggestions[highlightedIndex]);
      return;
    }
    if (isOpen && event.key === 'Escape') {
      event.preventDefault();
      closeSuggestions();
      return;
    }
    onKeyDown?.(event);
  };

  const isOpen = mentionQuery !== null;
  const activeDescendant = highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined;
  const dropdownPosition = placement === 'below' ? 'top-full mt-2' : 'bottom-full mb-2';

  return (
    <div className="relative w-full">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onSelect={(event) => updateMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => window.setTimeout(closeSuggestions, 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`w-full outline-none resize-none ${className}`}
        rows={minRows}
        dir="auto"
        role="combobox"
        aria-label={ariaLabel || placeholder}
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={activeDescendant}
      />

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t('mentions.suggestions')}
          className={`absolute z-50 ${dropdownPosition} w-full max-w-sm overflow-y-auto bg-white rounded-lg shadow-lg border border-gray-200`}
          style={{ insetInlineStart: 0, maxHeight: dropdownMaxHeight }}
        >
          {isLoading ? (
            <div className="min-h-12 flex items-center justify-center px-4 py-3 text-center text-sm text-gray-500 font-medium">
              {t('mentions.searching')}
            </div>
          ) : searchFailed ? (
            <div className="min-h-12 flex items-center justify-center px-4 py-3 text-center text-sm text-gray-500 font-medium">
              {t('mentions.searchFailed')}
            </div>
          ) : suggestions.length === 0 ? (
            <div className="min-h-12 flex items-center justify-center px-4 py-3 text-center text-sm text-gray-500 font-medium">
              {t('mentions.noUsersFound')}
            </div>
          ) : suggestions.map((user, index) => (
            <button
              id={`${listboxId}-option-${index}`}
              key={user.id}
              type="button"
              role="option"
              aria-selected={highlightedIndex === index}
              onPointerDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => insertMention(user)}
              onPointerMove={() => setHighlightedIndex(index)}
              className={`w-full min-h-12 flex items-center gap-3 px-3 py-2.5 transition-colors text-start ${highlightedIndex === index ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            >
              <UserAvatar
                src={user.avatar}
                mediaId={user.avatarMediaId}
                media={user.avatarMedia}
                name={user.name}
                alt=""
                size={32}
              />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-gray-900 truncate">{user.name}</span>
                <span className="block text-xs text-blue-600 font-medium truncate" dir="ltr">@{user.handle}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </div>
  );
};
