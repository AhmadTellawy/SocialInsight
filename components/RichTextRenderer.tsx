import React from 'react';

interface RichTextRendererProps {
  text: string;
  className?: string; // e.g. text-sm text-gray-700
  onUserClick?: (handle: string) => void;
  onHashtagClick?: (tag: string) => void;
}

export const RichTextRenderer: React.FC<RichTextRendererProps> = ({ 
  text, 
  className = '',
  onUserClick,
  onHashtagClick
}) => {
  if (!text) return null;

  // Match @username or #hashtag. 
  // We use a single capture group so split() includes the matches in the resulting array.
  const regex = /([@#][a-zA-Z0-9_.]+)/g;
  const parts = text.split(regex);

  return (
    <span className={`whitespace-pre-wrap break-words ${className}`}>
      {parts.map((part, index) => {
        if (!part) return null;

        if (part.startsWith('@')) {
          const handle = part.substring(1);
          return (
            <span 
              key={index}
              onClick={(e) => {
                if (onUserClick) {
                  e.stopPropagation();
                  onUserClick(handle);
                }
              }}
              className={`text-blue-600 font-semibold transition-colors ${onUserClick ? 'hover:underline cursor-pointer' : ''}`}
            >
              {part}
            </span>
          );
        }

        if (part.startsWith('#')) {
          const tag = part.substring(1);
          return (
            <span 
              key={index}
              onClick={(e) => {
                if (onHashtagClick) {
                  e.stopPropagation();
                  onHashtagClick(tag);
                }
              }}
              className={`text-blue-600 font-semibold transition-colors ${onHashtagClick ? 'hover:underline cursor-pointer' : ''}`}
            >
              {part}
            </span>
          );
        }

        return <span key={index}>{part}</span>;
      })}
    </span>
  );
};
