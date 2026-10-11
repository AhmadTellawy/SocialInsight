import {pagesApi} from '../../services/pagesApi';
import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { API_BASE_URL } from '../../services/api';
import { metadataPageHandle, parsePublicPageMetadata, writePageMetadata } from '../../utils/pageMetadata';

/** Mount once within PagesWorkspace. Server-rendered metadata remains a separate SEO boundary. */
export function PageMetadata() {
  const { pathname, search } = useLocation();
  useLayoutEffect(() => {
    const handle = metadataPageHandle(pathname);
    let stopped = false;
    let request: AbortController | null = null;
    writePageMetadata(document, null);
    const load = async () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const page=await pagesApi.get(handle!,controller.signal);
        if(page.publicMetadata!==undefined){if(!stopped&&request===controller)writePageMetadata(document,parsePublicPageMetadata(page.publicMetadata));return;}
        const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/pages-seo/${encodeURIComponent(handle!)}`, {
          credentials: 'omit', cache: 'no-store', signal: controller.signal,
        });
        const metadata = response.ok ? parsePublicPageMetadata(await response.json()) : null;
        if (!stopped && request === controller) writePageMetadata(document, metadata);
      } catch {
        if (!stopped && request === controller) writePageMetadata(document, null);
      } finally { clearTimeout(timeout); }
    };
    const refresh = () => {
      request?.abort();
      request = null;
      writePageMetadata(document, null);
      if (handle && document.visibilityState === 'visible') void load();
    };
    // Reporting is an account action even when the Page handle is public.
    const isReport = new URLSearchParams(search).get('tab') === 'report';
    if (handle && !isReport) {
      void load();
      window.addEventListener('focus', refresh);
      document.addEventListener('visibilitychange', refresh);
    }
    const received=(event:Event)=>{const detail=(event as CustomEvent).detail;if(!stopped&&!isReport&&detail?.handle===handle&&detail.metadata!==undefined)writePageMetadata(document,parsePublicPageMetadata(detail.metadata));};
    window.addEventListener('opiniup:page-metadata',received);
    return () => {
      stopped = true;
      request?.abort();
      window.removeEventListener('opiniup:page-metadata',received);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      writePageMetadata(document, null, false);
    };
  }, [pathname, search]);
  return null;
}
