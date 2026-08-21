import React, { useState, useRef, useEffect } from 'react';
import { api } from '../services/api';
import { createMentionSearchScheduler, MentionSearchScheduler } from '../utils/mentionAutocomplete';
import { ActiveMentionQuery, findActiveMentionQuery } from '../utils/textEntities';
import { UserAvatar } from './UserAvatar';

interface RichMentionInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string; // e.g. padding and bg color
  minRows?: number;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export const RichMentionInput: React.FC<RichMentionInputProps> = ({
  value,
  onChange,
  placeholder,
  className = '',
  minRows = 3,
  autoFocus = false,
  onKeyDown
}) => {
  const [mentionQuery, setMentionQuery] = useState<ActiveMentionQuery | null>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchSchedulerRef = useRef<MentionSearchScheduler<any> | null>(null);
  if (!searchSchedulerRef.current) {
    searchSchedulerRef.current = createMentionSearchScheduler((query, signal) => api.searchUsers(query, signal));
  }

  // Auto-resize logic
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'; // Reset
      textareaRef.current.style.height = `${Math.max(textareaRef.current.scrollHeight, minRows * 24)}px`;
    }
  }, [value, minRows]);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  // Debounced search for mentions
  useEffect(() => {
    const scheduler = searchSchedulerRef.current!;
    scheduler.cancel();
    setIsLoading(false);

    if (!mentionQuery) {
      setSuggestions([]);
      return;
    }

    scheduler.schedule(mentionQuery.text, {
      onStart: () => setIsLoading(true),
      onSuccess: (results) => setSuggestions(results || []),
      onError: () => console.error('Failed to fetch mention suggestions'),
      onSettled: () => setIsLoading(false)
    });

    return () => scheduler.cancel();
  }, [mentionQuery?.text]);

  const updateMentionQuery = (text: string, cursor: number) => {
    setMentionQuery(findActiveMentionQuery(text, cursor));
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);
    updateMentionQuery(text, e.target.selectionStart);
  };

  const insertMention = (handle: string) => {
    if (!mentionQuery) return;
    
    const textBeforeMention = value.substring(0, mentionQuery.index);
    const textAfterMentionCursor = value.substring(mentionQuery.end);
    
    const newText = `${textBeforeMention}@${handle} ${textAfterMentionCursor}`;
    const nextCursor = textBeforeMention.length + handle.length + 2;
    onChange(newText);
    setMentionQuery(null);
    setSuggestions([]);

    // Restore focus
    if (textareaRef.current) {
      textareaRef.current.focus();
      requestAnimationFrame(() => textareaRef.current?.setSelectionRange(nextCursor, nextCursor));
    }
  };

  return (
    <div className="relative w-full">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onSelect={(event) => updateMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => {
            // Delay zeroing out query to allow click on suggestion to register
            setTimeout(() => setMentionQuery(null), 200);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`w-full outline-none resize-none ${className}`}
        rows={minRows}
      />

      {/* Mention Highlight Overlay Wrapper (Optional, for rendering blue text while typing - skipping for simplicity unless needed, handled by RichTextRenderer on display) */}

      {/* Autocomplete Dropdown */}
      {(mentionQuery !== null && (suggestions.length > 0 || isLoading)) && (
        <div className="absolute z-50 bottom-full left-0 mb-2 w-full max-w-sm bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
          {isLoading ? (
             <div className="p-4 text-center text-sm text-gray-400 font-medium">Searching...</div>
          ) : (
            <ul className="max-h-48 overflow-y-auto no-scrollbar">
              {suggestions.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); insertMention(user.handle); }}
                    className="w-full flex items-center gap-3 p-3 hover:bg-blue-50 transition-colors text-left"
                  >
                    <UserAvatar src={user.avatar} mediaId={user.avatarMediaId} media={user.avatarMedia} name={user.name} alt={user.name || 'User'} size={32} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{user.name}</p>
                      <p className="text-xs text-blue-500 font-medium truncate">@{user.handle}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
