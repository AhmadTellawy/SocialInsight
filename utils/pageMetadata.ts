export interface PublicPageMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl: string | null;
}

const privatePaths = new Set(['create', 'mine', 'manage', 'staff', 'cases', 'invitations', 'blocks']);
const pagePath = /^\/pages\/([a-z][a-z0-9_]{2,29})\/?$/;

export function metadataPageHandle(pathname: string): string | null {
  const handle = pagePath.exec(pathname)?.[1];
  return handle && !privatePaths.has(handle) ? handle : null;
}

/** This accepts only the anonymous SEO endpoint's projection, never a management DTO. */
export function parsePublicPageMetadata(value: unknown): PublicPageMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 300 ||
      typeof data.description !== 'string' || data.description.length > 2000 ||
      typeof data.canonicalUrl !== 'string') return null;
  try {
    const canonical = new URL(data.canonicalUrl);
    if (canonical.origin !== 'https://opiniup.com' || canonical.username || canonical.password ||
        canonical.search || canonical.hash || !metadataPageHandle(canonical.pathname)) return null;
    let imageUrl: string | null = null;
    if (typeof data.imageUrl === 'string' && data.imageUrl) {
      const image = new URL(data.imageUrl);
      if (image.protocol !== 'https:' || image.username || image.password) return null;
      imageUrl = image.href;
    }
    return { title: data.title, description: data.description, canonicalUrl: canonical.href, imageUrl };
  } catch { return null; }
}

const metadataSelectors = 'meta[name="description"],meta[name="robots"],meta[property^="og:"],meta[name^="twitter:"],link[rel="canonical"]';

/** Attribute setters keep untrusted names/bios as literal text, never HTML. */
export function writePageMetadata(document: Document, metadata: PublicPageMetadata | null, active = true): void {
  document.querySelectorAll(metadataSelectors).forEach(element => element.remove());
  document.title = metadata?.title || 'Opiniup';
  const meta = (attribute: 'name' | 'property', key: string, content: string) => {
    const element = document.createElement('meta');
    element.setAttribute(attribute, key);
    element.setAttribute('content', content);
    element.setAttribute('data-pages-metadata', 'true');
    document.head.appendChild(element);
  };
  if (!active) return;
  meta('name', 'robots', metadata ? 'index, follow' : 'noindex, nofollow');
  if (!metadata) return;
  meta('name', 'description', metadata.description);
  meta('property', 'og:type', 'profile');
  meta('property', 'og:site_name', 'Opiniup');
  meta('property', 'og:title', metadata.title);
  meta('property', 'og:description', metadata.description);
  meta('property', 'og:url', metadata.canonicalUrl);
  if (metadata.imageUrl) meta('property', 'og:image', metadata.imageUrl);
  const canonical = document.createElement('link');
  canonical.setAttribute('rel', 'canonical');
  canonical.setAttribute('href', metadata.canonicalUrl);
  canonical.setAttribute('data-pages-metadata', 'true');
  document.head.appendChild(canonical);
}
