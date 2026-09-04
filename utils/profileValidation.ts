export const PROFILE_LINK_LIMIT = 5;
export const PROFILE_LINK_TITLE_MAX_LENGTH = 50;
export const PROFILE_LINK_URL_MAX_LENGTH = 2048;
export const PROFILE_MIN_AGE = 13;
export const PROFILE_MAX_AGE = 120;

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const WHITESPACE = /\s/;
const URL_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/;
const HTML_TAG = /<\/?[A-Za-z][^>]*>/;
const MARKDOWN_LINK_OR_IMAGE = /!?\[[^\]]*\]\([^)]*\)/;
const MARKDOWN_BLOCK = /(^|\n)\s{0,3}(?:#{1,6}\s|>\s|[-+*]\s|\d+\.\s)/;
const MARKDOWN_INLINE = /(?:`|\*\*|__|~~)/;

export type ProfileLinkTitleError = 'required' | 'tooLong' | 'controlCharacters' | 'markup';
export type ProfileLinkUrlError =
  | 'required'
  | 'tooLong'
  | 'controlCharacters'
  | 'whitespace'
  | 'protocolRelative'
  | 'invalidScheme'
  | 'credentials'
  | 'invalidUrl';

export type DateOnlyError = 'required' | 'invalidFormat' | 'invalidDate' | 'future' | 'underage' | 'tooOld';

export type ValidationResult<TValue, TError extends string> =
  | { valid: true; value: TValue }
  | { valid: false; error: TError };

export type NormalizedProfileLinkUrl = {
  /** Safe, absolute URL to store and open. */
  url: string;
  /** Canonical value suitable for per-user duplicate checks. */
  normalizedUrl: string;
  protocolAdded: boolean;
};

export type DateOnlyParts = {
  year: number;
  month: number;
  day: number;
};

export type DateOfBirthValidationOptions = {
  required?: boolean;
  minimumAge?: number;
  maximumAge?: number;
  today?: string | DateOnlyParts;
};

const characterCount = (value: string): number => Array.from(value).length;

export const normalizeProfileLinkTitle = (value: string): string => value.trim();

export const validateProfileLinkTitle = (
  value: string
): ValidationResult<string, ProfileLinkTitleError> => {
  const normalized = normalizeProfileLinkTitle(value);
  if (!normalized) return { valid: false, error: 'required' };
  if (CONTROL_CHARACTERS.test(value)) return { valid: false, error: 'controlCharacters' };
  if (characterCount(normalized) > PROFILE_LINK_TITLE_MAX_LENGTH) {
    return { valid: false, error: 'tooLong' };
  }
  if (
    HTML_TAG.test(normalized)
    || MARKDOWN_LINK_OR_IMAGE.test(normalized)
    || MARKDOWN_BLOCK.test(normalized)
    || MARKDOWN_INLINE.test(normalized)
  ) {
    return { valid: false, error: 'markup' };
  }
  return { valid: true, value: normalized };
};

const isValidIpv4 = (hostname: string): boolean => {
  const parts = hostname.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    const octet = Number(part);
    return octet >= 0 && octet <= 255;
  });
};

const isValidHostname = (hostname: string): boolean => {
  if (!hostname || hostname.length > 253) return false;
  if (hostname.startsWith('[') && hostname.endsWith(']')) return hostname.includes(':');
  if (isValidIpv4(hostname)) return true;

  const labels = hostname.toLowerCase().split('.');
  if (labels.length < 2 || labels.some((label) => (
    !label
    || label.length > 63
    || !/^[a-z\d-]+$/i.test(label)
    || label.startsWith('-')
    || label.endsWith('-')
  ))) {
    return false;
  }

  const topLevelDomain = labels.at(-1)!;
  return /^(?:[a-z]{2,63}|xn--[a-z\d-]{2,59})$/i.test(topLevelDomain);
};

export const normalizeProfileLinkUrl = (
  value: string
): ValidationResult<NormalizedProfileLinkUrl, ProfileLinkUrlError> => {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, error: 'required' };
  if (CONTROL_CHARACTERS.test(value)) return { valid: false, error: 'controlCharacters' };
  if (WHITESPACE.test(trimmed)) return { valid: false, error: 'whitespace' };
  if (characterCount(trimmed) > PROFILE_LINK_URL_MAX_LENGTH) {
    return { valid: false, error: 'tooLong' };
  }
  if (trimmed.startsWith('//')) return { valid: false, error: 'protocolRelative' };

  const hasScheme = URL_SCHEME.test(trimmed);
  if (hasScheme && !/^https?:/i.test(trimmed)) return { valid: false, error: 'invalidScheme' };

  const protocolAdded = !hasScheme;
  const candidate = protocolAdded ? `https://${trimmed}` : trimmed;
  if (candidate.includes('\\')) return { valid: false, error: 'invalidUrl' };
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { valid: false, error: 'invalidUrl' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return { valid: false, error: 'invalidScheme' };
  if (parsed.username || parsed.password) return { valid: false, error: 'credentials' };
  if (!isValidHostname(parsed.hostname)) return { valid: false, error: 'invalidUrl' };

  const url = parsed.toString();
  if (characterCount(url) > PROFILE_LINK_URL_MAX_LENGTH) {
    return { valid: false, error: 'tooLong' };
  }

  const duplicateKey = new URL(url);
  duplicateKey.hash = '';
  return {
    valid: true,
    value: {
      url,
      normalizedUrl: duplicateKey.toString(),
      protocolAdded
    }
  };
};

export const parseDateOnly = (value: string): DateOnlyParts | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > daysInMonth) return null;
  return { year, month, day };
};

export const serializeDateOnly = ({ year, month, day }: DateOnlyParts): string => (
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

export const todayAsDateOnly = (now = new Date()): DateOnlyParts => ({
  // Match the backend and cache refresh UTC boundary so validation and the
  // server cannot disagree for several hours on a user's birthday.
  year: now.getUTCFullYear(),
  month: now.getUTCMonth() + 1,
  day: now.getUTCDate()
});

export const compareDateOnly = (left: DateOnlyParts, right: DateOnlyParts): number => {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
};

export const calculateAgeFromDateOnly = (
  dateOfBirth: string | DateOnlyParts,
  today: string | DateOnlyParts = todayAsDateOnly()
): number | null => {
  const birth = typeof dateOfBirth === 'string' ? parseDateOnly(dateOfBirth) : dateOfBirth;
  const current = typeof today === 'string' ? parseDateOnly(today) : today;
  if (!birth || !current || compareDateOnly(birth, current) > 0) return null;

  let age = current.year - birth.year;
  if (current.month < birth.month || (current.month === birth.month && current.day < birth.day)) age -= 1;
  return age;
};

export const calculateAgeGroupFromDateOnly = (
  dateOfBirth: string | DateOnlyParts,
  today: string | DateOnlyParts = todayAsDateOnly()
): string | null => {
  const age = calculateAgeFromDateOnly(dateOfBirth, today);
  if (age === null) return null;
  if (age < 18) return 'Under 18';
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  return '55+';
};

export const validateDateOfBirth = (
  value: string | null | undefined,
  options: DateOfBirthValidationOptions = {}
): ValidationResult<string | null, DateOnlyError> => {
  const normalized = value?.trim() || '';
  if (!normalized) {
    return options.required ? { valid: false, error: 'required' } : { valid: true, value: null };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return { valid: false, error: 'invalidFormat' };

  const birth = parseDateOnly(normalized);
  if (!birth) return { valid: false, error: 'invalidDate' };
  const today = typeof options.today === 'string'
    ? parseDateOnly(options.today)
    : options.today || todayAsDateOnly();
  if (!today) return { valid: false, error: 'invalidDate' };
  if (compareDateOnly(birth, today) > 0) return { valid: false, error: 'future' };

  const age = calculateAgeFromDateOnly(birth, today);
  if (age === null) return { valid: false, error: 'invalidDate' };
  if (age < (options.minimumAge ?? PROFILE_MIN_AGE)) return { valid: false, error: 'underage' };
  if (age > (options.maximumAge ?? PROFILE_MAX_AGE)) return { valid: false, error: 'tooOld' };
  return { valid: true, value: normalized };
};

export const formatDateOnly = (
  value: string,
  locale?: string,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' }
): string => {
  const parts = parseDateOnly(value);
  if (!parts) return '';
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(utcDate);
};

export const truncateProfileUrl = (value: string, maximumLength = 56): string => {
  const compact = value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (characterCount(compact) <= maximumLength) return compact;
  return `${Array.from(compact).slice(0, Math.max(1, maximumLength - 1)).join('')}…`;
};
