import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { MediaPresentation } from '../../types';
import { mediaApi } from '../../services/mediaApi';
import { API_BASE_URL, authFetch } from '../../services/api';

type MediaImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'width' | 'height'> & {
  media?: MediaPresentation | null;
  mediaId?: string | null;
  fallbackSrc?: string | null;
  fallback?: React.ReactNode;
  eager?: boolean;
  useFocalPoint?: boolean;
  onUnavailable?: () => void;
};

export const MediaImage: React.FC<MediaImageProps> = ({
  media,
  mediaId,
  fallbackSrc,
  fallback,
  eager = false,
  useFocalPoint = false,
  onUnavailable,
  alt,
  sizes,
  style,
  onError,
  ...imageProps
}) => {
  const id = media?.id || mediaId || undefined;
  const identity = `${id || ''}:${media?.src || ''}:${fallbackSrc || ''}`;
  const initial = useMemo<MediaPresentation | null>(() => {
    if (media) return media;
    if (!fallbackSrc) return null;
    return { id: '', access: 'PUBLIC', aspectRatio: 1, width: 1, height: 1, src: fallbackSrc };
  }, [identity]);
  const [resolved, setResolved] = useState<MediaPresentation | null>(initial);
  const [failed, setFailed] = useState(false);
  const [protectedImage, setProtectedImage] = useState<{ identity: string; source: string; url: string } | null>(null);
  const protectedSrc = protectedImage?.identity === identity && protectedImage.source === resolved?.src ? protectedImage.url : null;
  const [loading, setLoading] = useState(Boolean(id && !initial?.src));
  const retriedSourceRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setResolved(initial);
    setFailed(false);
    setLoading(Boolean(id && !initial?.src));
    retriedSourceRef.current = null;
    if (id && !initial?.src) {
      mediaApi.get(id).then((result) => {
        if (active) setResolved(result);
      }).catch(() => {
        if (active) {
          setFailed(true);
          onUnavailable?.();
        }
      }).finally(() => {
        if (active) setLoading(false);
      });
    } else {
      setLoading(false);
    }
    return () => { active = false; };
  }, [identity, id, initial]);

  useEffect(() => {
    setProtectedImage(null);
    if (!resolved?.requiresAuth || !resolved.src) return;
    const source = resolved.src;
    const controller = new AbortController();
    let currentBlob: string | null = null;
    let busy = false;
    let recheckQueued = false;
    const clearBlob = () => {
      setProtectedImage(null);
      if (currentBlob) URL.revokeObjectURL(currentBlob);
      currentBlob = null;
    };
    const load = async () => {
      if (controller.signal.aborted) return;
      if (busy) { recheckQueued = true; return; }
      busy = true;
      try {
        const requestIdentity = localStorage.getItem('si_token');
        const sourceUrl = new URL(source, window.location.origin);
        const apiUrl = new URL(API_BASE_URL, window.location.origin);
        const relativeApi = source.startsWith('/api/media/');
        if (!relativeApi && (sourceUrl.origin !== apiUrl.origin || !sourceUrl.pathname.startsWith(apiUrl.pathname.replace(/\/$/, '') + '/media/'))) throw new Error('Invalid protected media source');
        if (currentBlob && id) {
          // Bypass the general metadata cache: authorize against the current Page,
          // post, account and role without downloading unchanged image bytes.
          const response = await authFetch(`/api/media/${encodeURIComponent(id)}`, { signal: controller.signal, cache: 'no-store', timeoutMs: 20000 });
          if (!response.ok) throw new Error('Media unavailable');
          const presentation = await response.json() as MediaPresentation;
          if (presentation.id !== id || !presentation.requiresAuth || presentation.src !== source) throw new Error('Media presentation changed');
        } else {
          const response = await authFetch(source, { signal: controller.signal, cache: 'no-store', timeoutMs: 20000 });
          if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Media unavailable');
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          currentBlob = URL.createObjectURL(blob);
        }
        if (controller.signal.aborted) return;
        if (requestIdentity !== localStorage.getItem('si_token')) throw new Error('Media session changed');
        if (document.visibilityState === 'visible' && currentBlob) setProtectedImage({identity,source,url:currentBlob});
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) {
          clearBlob();
          setFailed(true);
          onUnavailable?.();
        }
      } finally {
        busy = false;
        if (recheckQueued && !controller.signal.aborted) { recheckQueued = false; void load(); }
      }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000);
    const onFocus = () => { setProtectedImage(null); void load(); };
    const onVisibility = () => {
      setProtectedImage(null);
      if (document.visibilityState === 'visible') void load();
    };
    const onAuthChanged = () => { clearBlob(); void load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('auth_expired', onAuthChanged);
    window.addEventListener('storage', onAuthChanged);
    return () => {
      controller.abort(); clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('auth_expired', onAuthChanged);
      window.removeEventListener('storage', onAuthChanged);
      if (currentBlob) URL.revokeObjectURL(currentBlob);
    };
  }, [resolved?.requiresAuth, resolved?.src, identity, id]);

  const refresh = async (): Promise<void> => {
    if (!id) {
      setFailed(true);
      return;
    }
    setLoading(true);
    try {
      setResolved(await mediaApi.get(id, true));
      setFailed(false);
    } catch {
      setFailed(true);
      onUnavailable?.();
    } finally {
      setLoading(false);
    }
  };

  if (loading || (resolved?.requiresAuth && !protectedSrc && !failed)) {
    return <span aria-busy="true" className="flex h-full w-full animate-pulse items-center justify-center bg-gray-100 text-gray-300"><ImageOff size={20} aria-hidden="true" /></span>;
  }

  if (failed || !resolved?.src) {
    return <>{fallback || <span role="img" aria-label={alt || 'Image unavailable'} className="flex h-full w-full items-center justify-center bg-gray-100 text-gray-400"><ImageOff size={20} aria-hidden="true" /></span>}</>;
  }

  return (
    <img
      {...imageProps}
      src={resolved.requiresAuth ? protectedSrc || undefined : resolved.src}
      srcSet={resolved.requiresAuth ? undefined : resolved.srcSet}
      sizes={sizes}
      width={resolved.width || undefined}
      height={resolved.height || undefined}
      alt={alt ?? resolved.altText ?? ''}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      crossOrigin="anonymous"
      style={{
        ...style,
        objectPosition: style?.objectPosition || (useFocalPoint && resolved.focalX !== undefined && resolved.focalY !== undefined
          ? `${resolved.focalX * 100}% ${resolved.focalY * 100}%`
          : undefined)
      }}
      onError={(event) => {
        onError?.(event);
        if (!id || retriedSourceRef.current === resolved.src) {
          setFailed(true);
          onUnavailable?.();
          return;
        }
        retriedSourceRef.current = resolved.src;
        void refresh();
      }}
    />
  );
};
