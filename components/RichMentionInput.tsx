import React, { useState, useRef, useEffect } from 'react';
import { api } from '../services/api';

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
  const [mentionQuery, setMentionQuery] = useState<{ text: string, index: number } | null>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    if (!mentionQuery) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsLoading(true);
        const results = await api.searchUsers(mentionQuery.text);
        setSuggestions(results || []);
      } catch (err) {
        console.error("Failed to fetch mention suggestions:", err);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [mentionQuery?.text]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);

    const cursor = e.target.selectionStart;
    const textBeforeCursor = text.substring(0, cursor);
    
    // Find if the last word before cursor starts with '@'
    const words = textBeforeCursor.split(/\s/);
    const lastWord = words[words.length - 1];

    if (lastWord.startsWith('@')) {
      const matchText = lastWord.substring(1);
      // Valid mention search text: alphanumeric and underscores/dots
      if (/^[a-zA-Z0-9_.]*$/.test(matchText)) {
        setMentionQuery({ 
          text: matchText, 
          index: cursor - lastWord.length // Index where the '@' starts
        });
        return;
      }
    }
    
    setMentionQuery(null);
  };

  const insertMention = (handle: string) => {
    if (!mentionQuery) return;
    
    const textBeforeMention = value.substring(0, mentionQuery.index);
    const textAfterMentionCursor = value.substring(mentionQuery.index + mentionQuery.text.length + 1); // +1 for the '@'
    
    const newText = `${textBeforeMention}@${handle} ${textAfterMentionCursor}`;
    onChange(newText);
    setMentionQuery(null);
    setSuggestions([]);

    // Restore focus
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  return (
    <div className="relative w-full">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onSelect={handleChange} // Capture cursor changes
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
                    <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden shrink-0">
                        {user.avatar ? (
                          <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-blue-100 text-blue-500 font-bold text-xs uppercase">
                            {user.name.charAt(0)}
                          </div>
                        )}
                    </div>
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
