export const PROFILE_LINK_LIMIT = 5;
export const PROFILE_LINK_TITLE_MAX_LENGTH = 50;
export const PROFILE_LINK_URL_MAX_LENGTH = 2048;
export const PROFILE_MINIMUM_AGE = 13;
export const PROFILE_MAXIMUM_AGE = 120;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const ABSOLUTE_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const HTML_TAG = /<\/?[A-Za-z][^>]*>/;
const MARKDOWN_LINK_OR_IMAGE = /!?\[[^\]]*\]\([^)]*\)/;
const MARKDOWN_BLOCK = /(^|\n)\s{0,3}(?:#{1,6}\s|>\s|[-+*]\s|\d+\.\s)/;
const MARKDOWN_INLINE = /(?:`|\*\*|__|~~)/;

const characterCount = (value: string): number => Array.from(value).length;

export class ProfileValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'ProfileValidationError';
  }
}

export type NormalizedProfileLink = {
  title: string;
  url: string;
  normalizedUrl: string;
};

const isValidIpv4 = (hostname: string): boolean => {
  const parts = hostname.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith('0'))) return false;
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
  ))) return false;
  const topLevelDomain = labels[labels.length - 1];
  return /^(?:[a-z]{2,63}|xn--[a-z\d-]{2,59})$/i.test(topLevelDomain);
};

export const normalizeProfileLinkUrl = (value: unknown): { url: string; normalizedUrl: string } => {
  if (typeof value !== 'string') {
    throw new ProfileValidationError('INVALID_PROFILE_LINK_URL', 'A link URL is required.');
  }
  const trimmed = value.trim();
  if (!trimmed || characterCount(trimmed) > PROFILE_LINK_URL_MAX_LENGTH || CONTROL_CHARACTERS.test(value) || /\s/.test(trimmed)) {
    throw new ProfileValidationError('INVALID_PROFILE_LINK_URL', 'Enter a valid web address.');
  }
  if (trimmed.startsWith('//')) {
    throw new ProfileValidationError('INVALID_PROFILE_LINK_URL', 'Protocol-relative links are not allowed.');
  }

  const addedProtocol = !ABSOLUTE_SCHEME.test(trimmed);
  if (!addedProtocol && !/^https?:/i.test(trimmed)) {
    throw new ProfileValidationError('INVALID_PROFILE_LINK_SCHEME', 'Only http:// and https:// links are allowed.');
  }
  const candidate = addedProtocol ? `https://${trimmed}` : trimmed;
  if (candidate.includes('\\')) {
    throw new ProfileValidationError('INVALID_PROFILE_LINK_URL', 'Enter a valid web address.');
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ProfileValidationError('INVALID_PROFILE_LINK_URL', 'Enter a valid web address.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProfileValidationError('INVALID_PROFILE_LINK_SCHEME', 'Only http:// and https:// links are allowed.');
  }
  if (parsed.username || parsed.password) {
    throw new ProfileValidationError('INVALID_PROFILE_LINK_CREDENTIALS', 'Links cannot contain a username or password.');
  }
  if (!isValidHostname(parsed.hostname)) {
    throw new ProfileValidationError('INVALID_PROFILE_LINK_URL', 'Enter a valid web address.');
  }

  const canonical = parsed.href;
  if (characterCount(canonical) > PROFILE_LINK_URL_MAX_LENGTH) {
    throw new ProfileValidationError('PROFILE_LINK_URL_TOO_LONG', 'The link URL cannot exceed 2048 characters.');
  }
  const duplicateKey = new URL(canonical);
  duplicateKey.hash = '';
  return { url: canonical, normalizedUrl: duplicateKey.toString() };
};

export const normalizeProfileLinkInput = (titleValue: unknown, urlValue: unknown): NormalizedProfileLink => {
  if (typeof titleValue !== 'string') {
    throw new ProfileValidationError('INVALID_PROFILE_LINK_TITLE', 'A link title is required.');
  }
  const title = titleValue.trim();
  if (
    !title
    || characterCount(title) > PROFILE_LINK_TITLE_MAX_LENGTH
    || CONTROL_CHARACTERS.test(titleValue)
    || HTML_TAG.test(title)
    || MARKDOWN_LINK_OR_IMAGE.test(title)
    || MARKDOWN_BLOCK.test(title)
    || MARKDOWN_INLINE.test(title)
  ) {
    throw new ProfileValidationError('INVALID_PROFILE_LINK_TITLE', 'Link titles must be plain text between 1 and 50 characters.');
  }
  return { title, ...normalizeProfileLinkUrl(urlValue) };
};

export const formatDateOnly = (value: Date | null | undefined): string | null => {
  if (!value) return null;
  return [
    value.getUTCFullYear().toString().padStart(4, '0'),
    (value.getUTCMonth() + 1).toString().padStart(2, '0'),
    value.getUTCDate().toString().padStart(2, '0')
  ].join('-');
};

export const ageOnDate = (dateOfBirth: Date, today: Date = new Date()): number => {
  const todayYear = today.getUTCFullYear();
  const todayMonth = today.getUTCMonth();
  const todayDay = today.getUTCDate();
  let age = todayYear - dateOfBirth.getUTCFullYear();
  const birthMonth = dateOfBirth.getUTCMonth();
  const birthDay = dateOfBirth.getUTCDate();
  if (todayMonth < birthMonth || (todayMonth === birthMonth && todayDay < birthDay)) age -= 1;
  return age;
};

export const parseAndValidateDateOfBirth = (value: unknown, today: Date = new Date()): Date => {
  if (typeof value !== 'string') {
    throw new ProfileValidationError('INVALID_DATE_OF_BIRTH', 'Date of birth must use YYYY-MM-DD.');
  }
  const match = DATE_ONLY.exec(value);
  if (!match) {
    throw new ProfileValidationError('INVALID_DATE_OF_BIRTH', 'Date of birth must use YYYY-MM-DD.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new ProfileValidationError('INVALID_DATE_OF_BIRTH', 'Enter a real calendar date.');
  }

  const todayOnly = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (parsed.getTime() > todayOnly.getTime()) {
    throw new ProfileValidationError('DATE_OF_BIRTH_IN_FUTURE', 'Date of birth cannot be in the future.');
  }
  const age = ageOnDate(parsed, todayOnly);
  if (age < PROFILE_MINIMUM_AGE) {
    throw new ProfileValidationError('MINIMUM_AGE_NOT_MET', `You must be at least ${PROFILE_MINIMUM_AGE} years old.`);
  }
  if (age > PROFILE_MAXIMUM_AGE) {
    throw new ProfileValidationError('INVALID_DATE_OF_BIRTH_RANGE', 'Enter a date of birth within the supported range.');
  }
  return parsed;
};

export const calculateAgeGroupFromDate = (dateOfBirth: Date | null | undefined, today: Date = new Date()): string | undefined => {
  if (!dateOfBirth) return undefined;
  const age = ageOnDate(dateOfBirth, today);
  if (age < 18) return 'Under 18';
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  return '55+';
};
