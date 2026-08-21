export type TextEntityType = 'mention' | 'hashtag';

export interface TextEntity {
  type: TextEntityType;
  raw: string;
  value: string;
  normalizedValue: string;
  start: number;
  end: number;
}

export interface ActiveMentionQuery {
  text: string;
  index: number;
  end: number;
}

export const MENTION_RECIPIENT_LIMIT = 10;

const MENTION_CHARACTER = /^[A-Za-z0-9_.]$/;
const MENTION_BOUNDARY_BLOCKER = /^[\p{L}\p{N}\p{M}_.%+\-@#]$/u;
const HASHTAG_FIRST_CHARACTER = /^[\p{L}\p{N}]$/u;
const HASHTAG_CHARACTER = /^[\p{L}\p{N}\p{M}_]$/u;
const HASHTAG_BOUNDARY_BLOCKER = /^[\p{L}\p{N}\p{M}_@#]$/u;

const characterAt = (text: string, index: number): string => {
  const codePoint = text.codePointAt(index);
  return codePoint === undefined ? '' : String.fromCodePoint(codePoint);
};

const previousCharacter = (text: string, index: number): string => {
  if (index <= 0) return '';
  const trailingCodeUnit = text.charCodeAt(index - 1);
  if (trailingCodeUnit >= 0xdc00 && trailingCodeUnit <= 0xdfff && index >= 2) {
    return text.slice(index - 2, index);
  }
  return text[index - 1];
};

export const normalizeMentionHandle = (handle: string): string => handle.toLowerCase();

export const normalizeHashtag = (hashtag: string): string => hashtag.normalize('NFC').toLowerCase();

export const parseTextEntities = (text: string): TextEntity[] => {
  const entities: TextEntity[] = [];
  let index = 0;

  while (index < text.length) {
    const marker = text[index];

    if (marker === '@') {
      const previous = previousCharacter(text, index);
      if (!previous || !MENTION_BOUNDARY_BLOCKER.test(previous)) {
        const bodyStart = index + 1;
        let cursor = bodyStart;

        while (cursor < text.length) {
          const character = characterAt(text, cursor);
          if (!MENTION_CHARACTER.test(character)) break;
          cursor += character.length;
        }

        let end = cursor;
        while (end > bodyStart && text[end - 1] === '.') end -= 1;

        if (end > bodyStart) {
          const value = text.slice(bodyStart, end);
          entities.push({
            type: 'mention',
            raw: text.slice(index, end),
            value,
            normalizedValue: normalizeMentionHandle(value),
            start: index,
            end
          });
          index = end;
          continue;
        }
      }
    }

    if (marker === '#') {
      const previous = previousCharacter(text, index);
      const bodyStart = index + 1;
      const first = characterAt(text, bodyStart);

      if ((!previous || !HASHTAG_BOUNDARY_BLOCKER.test(previous)) && HASHTAG_FIRST_CHARACTER.test(first)) {
        let cursor = bodyStart + first.length;
        while (cursor < text.length) {
          const character = characterAt(text, cursor);
          if (!HASHTAG_CHARACTER.test(character)) break;
          cursor += character.length;
        }

        const value = text.slice(bodyStart, cursor);
        entities.push({
          type: 'hashtag',
          raw: text.slice(index, cursor),
          value,
          normalizedValue: normalizeHashtag(value),
          start: index,
          end: cursor
        });
        index = cursor;
        continue;
      }
    }

    index += characterAt(text, index).length || 1;
  }

  return entities;
};

export const getUniqueMentionHandles = (text: string): string[] => {
  const handles = parseTextEntities(text)
    .filter((entity) => entity.type === 'mention')
    .map((entity) => entity.normalizedValue);
  return Array.from(new Set(handles));
};

export const hasMentionRecipientOverflow = (text: string): boolean =>
  getUniqueMentionHandles(text).length > MENTION_RECIPIENT_LIMIT;

export const findActiveMentionQuery = (text: string, cursor: number): ActiveMentionQuery | null => {
  const boundedCursor = Math.max(0, Math.min(cursor, text.length));
  let bodyStart = boundedCursor;

  while (bodyStart > 0 && MENTION_CHARACTER.test(text[bodyStart - 1])) {
    bodyStart -= 1;
  }

  const markerIndex = bodyStart - 1;
  if (markerIndex < 0 || text[markerIndex] !== '@') return null;

  const previous = previousCharacter(text, markerIndex);
  if (previous && MENTION_BOUNDARY_BLOCKER.test(previous)) return null;

  return {
    text: text.slice(bodyStart, boundedCursor),
    index: markerIndex,
    end: boundedCursor
  };
};
