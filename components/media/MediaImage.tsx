import React, { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { MediaPresentation } from '../../types';
import { mediaApi } from '../../services/mediaApi';

type MediaImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'width' | 'height'> & {
  media?: MediaPresentation | null;
  mediaId?: string | null;
  fallbackSrc?: string | null;
  fallback?: React.ReactNode;
  eager?: boolean;
  useFocalPoint?: boolean;
  onUnavailable?: () => void;
};

export const MediaImage: React.FC<MediaImageProps> = (props) => (
  <MediaImageSource
    key={JSON.stringify([props.media?.id || props.mediaId, props.media?.access, props.media?.src, props.media?.srcSet, props.fallbackSrc])}
    {...props}
  />
);

// A source/access change starts a new lifecycle synchronously: a previous image
// or an in-flight refresh must never appear under another identity or audience.
const MediaImageSource: React.FC<MediaImageProps> = ({
  media,
  mediaId,
  fallbackSrc,
  fallback,
  eager = false,
  useFocalPoint = false,
  onUnavailable,
  alt,
  sizes,
  className,
  style,
  onError,
  onLoad,
  ...imageProps
}) => {
  const id = media?.id || mediaId || undefined;
  const identity = id ? `media:${id}` : (media?.src || fallbackSrc ? `src:${media?.src || fallbackSrc}` : 'empty');
  const initial: MediaPresentation | null = media || (fallbackSrc
    ? { id: '', access: 'PUBLIC', aspectRatio: 1, width: 1, height: 1, src: fallbackSrc }
    : null);
  const [view, setView] = useState(() => ({
    identity,
    resolved: initial,
    failed: false,
    loading: Boolean(id && !initial?.src)
  }));
  const currentIdentityRef = useRef(identity);
  const activeRef = useRef(false);
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const retryRef = useRef({ identity, attempted: false });
  currentIdentityRef.current = identity;
  if (retryRef.current.identity !== identity) retryRef.current = { identity, attempted: false };

  // Never render state retained from another media identity, including during the
  // render before the identity-change effect commits.
  const currentView = view.identity === identity
    ? view
    : { identity, resolved: initial, failed: false, loading: Boolean(id && !initial?.src) };

  useEffect(() => {
    let active = true;
    activeRef.current = true;
    if (id && !initial?.src) {
      mediaApi.get(id).then((result) => {
        if (active && currentIdentityRef.current === identity) {
          setView({ identity, resolved: result, failed: false, loading: false });
        }
      }).catch(() => {
        if (active && currentIdentityRef.current === identity) {
          setView({ identity, resolved: null, failed: true, loading: false });
          onUnavailableRef.current?.();
        }
      }).finally(() => {
        if (active && currentIdentityRef.current === identity) {
          setView((previous) => previous.identity === identity ? { ...previous, loading: false } : previous);
        }
      });
    }
    return () => { active = false; activeRef.current = false; };
  }, [identity, id]);

  const refresh = async (failedSource: string): Promise<void> => {
    if (!id) {
      setView((previous) => previous.identity === identity ? { ...previous, failed: true, loading: false } : previous);
      return;
    }
    const requestIdentity = identity;
    try {
      const refreshed = await mediaApi.get(id, true);
      if (!activeRef.current || currentIdentityRef.current !== requestIdentity) return;
      setView((previous) => previous.identity === requestIdentity
        ? {
            ...previous,
            resolved: refreshed,
            failed: !refreshed.src || refreshed.src === failedSource,
            loading: false
          }
        : previous);
      if (!refreshed.src || refreshed.src === failedSource) onUnavailableRef.current?.();
    } catch {
      if (activeRef.current && currentIdentityRef.current === requestIdentity) {
        setView((previous) => previous.identity === requestIdentity
          ? { ...previous, failed: true, loading: false }
          : previous);
        onUnavailableRef.current?.();
      }
    }
  };

  const placeholderStyle = {
    aspectRatio: initial?.aspectRatio || currentView.resolved?.aspectRatio || undefined,
    ...style
  };

  if (currentView.loading) {
    if (fallback) return <>{fallback}</>;
    return <span aria-busy="true" className={`flex h-full w-full items-center justify-center bg-gray-100 text-gray-300 ${className || ''}`} style={placeholderStyle}><ImageOff size={20} aria-hidden="true" /></span>;
  }

  if (currentView.failed || !currentView.resolved?.src) {
    return <>{fallback || <span role="img" aria-label={alt || 'Image unavailable'} className={`flex h-full w-full items-center justify-center bg-gray-100 text-gray-400 ${className || ''}`} style={placeholderStyle}><ImageOff size={20} aria-hidden="true" /></span>}</>;
  }

  const resolved = currentView.resolved;

  return (
    <img
      {...imageProps}
      src={resolved.src}
      srcSet={resolved.srcSet}
      sizes={sizes}
      className={className}
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
        if (!id || retryRef.current.attempted) {
          setView((previous) => previous.identity === identity ? { ...previous, failed: true, loading: false } : previous);
          onUnavailable?.();
          return;
        }
        retryRef.current.attempted = true;
        void refresh(resolved.src);
      }}
      onLoad={(event) => {
        onLoad?.(event);
      }}
    />
  );
};
