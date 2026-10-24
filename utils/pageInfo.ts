import type { PageInfo } from '../services/pagesApi';

export const normalizePagePhone = (value: string) => value.trim().replace(/[٠-٩۰-۹]/g,
  digit => String(digit.charCodeAt(0) - (digit >= '۰' ? 0x06f0 : 0x0660)));
export const normalizePageUrl = (value: string) => {
  const trimmed = value.trim();
  return trimmed && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.startsWith('//') ? 'https://' + trimmed : trimmed;
};

/** Only empty link rows are omitted. Partially completed rows still need correction. */
export function preparePageInfo(info: PageInfo): PageInfo {
  const next = { ...info, name: info.name.trim(), bio: info.bio.trim(),
    website: info.website?.trim() ? normalizePageUrl(info.website) : null,
    publicEmail: info.publicEmail?.trim() || null,
    publicPhone: info.publicPhone?.trim() ? normalizePagePhone(info.publicPhone) : null,
    links: info.links.filter(link => link.title.trim() || link.url.trim())
      .map(link => ({ title: link.title.trim(), url: normalizePageUrl(link.url) })) };
  if ((next.cta === 'WEBSITE' && !next.website) || (next.cta === 'EMAIL' && !next.publicEmail) ||
      (next.cta === 'PHONE' && !next.publicPhone)) next.cta = null;
  return next;
}
