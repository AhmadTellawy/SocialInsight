import React, { useEffect, useMemo, useRef, useState } from 'react';
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

  if (loading) {
    return <span aria-busy="true" className="flex h-full w-full animate-pulse items-center justify-center bg-gray-100 text-gray-300"><ImageOff size={20} aria-hidden="true" /></span>;
  }

  if (failed || !resolved?.src) {
    return <>{fallback || <span role="img" aria-label={alt || 'Image unavailable'} className="flex h-full w-full items-center justify-center bg-gray-100 text-gray-400"><ImageOff size={20} aria-hidden="true" /></span>}</>;
  }

  return (
    <img
      {...imageProps}
      src={resolved.src}
      srcSet={resolved.srcSet}
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
