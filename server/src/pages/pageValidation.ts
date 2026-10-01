/// <reference lib="es2022.intl" />
import { z } from 'zod';
import { PAGE_CATEGORIES, PAGE_POLICY } from './pagePolicy';

const invisibleOrControl = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
const visibleLength = (value:string) => Array.from(graphemes.segment(value)).length;
const reserved = new Set(['admin', 'api', 'app', 'auth', 'about', 'account', 'accounts', 'business',
  'create', 'dashboard', 'discover', 'edit', 'explore', 'feed', 'help', 'home', 'invitations',
  'login', 'logout', 'manage', 'me', 'mine', 'moderation', 'new', 'notifications', 'opiniup',
  'pages', 'privacy', 'profile', 'reports', 'search', 'settings', 'socialinsight', 'staff',
  'support', 'system', 'team', 'terms', 'transfers', 'verified', 'www']);

const visibleText = (minimum: number, maximum: number, multiline=false) => z.string().trim().transform(value=>value.normalize('NFC'))
  .refine(value => !invisibleOrControl.test(multiline?value.replace(/\r?\n/g,''):value), 'Unsupported invisible or control characters')
  .refine(value => visibleLength(value) >= minimum && visibleLength(value) <= maximum,
    `Use ${minimum}–${maximum} characters`);

export const pageHandleSchema = z.string().trim().transform(value => value.toLowerCase())
  .pipe(z.string().regex(/^[a-z][a-z0-9_]{2,29}$/, 'Use 3–30 letters, numbers or underscores; start with a letter'))
  .refine(value => !reserved.has(value), 'This handle is reserved');

export const pageWebUrlSchema = z.string().trim().max(2048).url().refine(value => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
      !invisibleOrControl.test(value);
  } catch { return false; }
}, 'Use an HTTP or HTTPS address without credentials');

export const pageInfoSchema = z.object({
  name: visibleText(2, 100),
  category: z.enum(PAGE_CATEGORIES),
  bio: visibleText(1, 160),
  description: visibleText(0, 2000, true).default(''),
  country: visibleText(0, 100).default(''),
  city: visibleText(0, 100).default(''),
  website: pageWebUrlSchema.nullable().default(null),
  links: z.array(z.object({ title: visibleText(1, 50), url: pageWebUrlSchema }).strict())
    .max(PAGE_POLICY.maxLinks).default([]),
  publicEmail: z.string().trim().email().max(254).nullable().default(null),
  publicPhone: z.string().trim().regex(/^\+?[0-9 ()-]{5,30}$/).nullable().default(null),
  cta: z.enum(['WEBSITE', 'EMAIL', 'PHONE']).nullable().default(null),
}).strict();

export const validatePageCta = (value: { cta: string | null; website: string | null;
  publicEmail: string | null; publicPhone: string | null }): boolean =>
  value.cta === null || (value.cta === 'WEBSITE' && !!value.website) ||
  (value.cta === 'EMAIL' && !!value.publicEmail) || (value.cta === 'PHONE' && !!value.publicPhone);

export const pageCreateSchema = pageInfoSchema.extend({
  handle: pageHandleSchema,
  representationConfirmed: z.literal(true),
  requestId: z.string().uuid(),
}).refine(validatePageCta, 'The action needs matching public contact information');

export const pagePatchSchema = pageInfoSchema.partial();

/** Spreadsheet programs interpret formulas even in quoted CSV fields. */
export const pageCsvCell = (value: string | number): string => {
  const raw = String(value);
  const safe = /^[\s]*[=+\-@\t\r]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
};
