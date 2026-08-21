import React from 'react';
import { parseTextEntities } from '../utils/textEntities';

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

  const entities = parseTextEntities(text);
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  entities.forEach((entity) => {
    if (entity.start > cursor) {
      parts.push(<span key={`text-${cursor}`}>{text.slice(cursor, entity.start)}</span>);
    }

    if (entity.type === 'mention') {
      parts.push(
        <span
          key={`mention-${entity.start}`}
          onClick={(event) => {
            if (onUserClick) {
              event.stopPropagation();
              onUserClick(entity.normalizedValue);
            }
          }}
          className={`text-blue-600 font-semibold transition-colors ${onUserClick ? 'hover:underline cursor-pointer' : ''}`}
        >
          {entity.raw}
        </span>
      );
    } else {
      parts.push(
        <span
          key={`hashtag-${entity.start}`}
          onClick={(event) => {
            if (onHashtagClick) {
              event.stopPropagation();
              onHashtagClick(entity.value);
            }
          }}
          className={`text-blue-600 font-semibold transition-colors ${onHashtagClick ? 'hover:underline cursor-pointer' : ''}`}
        >
          {entity.raw}
        </span>
      );
    }

    cursor = entity.end;
  });

  if (cursor < text.length) {
    parts.push(<span key={`text-${cursor}`}>{text.slice(cursor)}</span>);
  }

  return (
    <span className={`whitespace-pre-wrap break-words ${className}`}>
      {parts}
    </span>
  );
};
