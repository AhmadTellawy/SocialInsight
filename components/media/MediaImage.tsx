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

type MediaImagePhase = 'resolving' | 'loading' | 'decoding' | 'ready' | 'failed';
type MediaSourceKind = 'primary' | 'fallback';

const presentationForFallback = (
  fallbackSrc: string,
  media?: MediaPresentation | null
): MediaPresentation => ({
  id: '',
  access: 'PUBLIC',
  // Legacy URLs do not carry trustworthy dimensions. Keep those values
  // unknown so fixed-size callers retain their frame and fluid content keeps
  // its natural ratio instead of being cropped into an invented square.
  aspectRatio: media?.aspectRatio || 0,
  width: media?.width || 0,
  height: media?.height || 0,
  src: fallbackSrc
});

const objectFitFor = (
  className: string,
  explicit?: React.CSSProperties['objectFit']
): React.CSSProperties['objectFit'] => {
  if (explicit) return explicit;
  if (/(?:^|\s)object-contain(?:\s|$)/.test(className)) return 'contain';
  if (/(?:^|\s)object-fill(?:\s|$)/.test(className)) return 'fill';
  if (/(?:^|\s)object-none(?:\s|$)/.test(className)) return 'none';
  if (/(?:^|\s)object-scale-down(?:\s|$)/.test(className)) return 'scale-down';
  return 'cover';
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
  className = '',
  onLoad,
  onError,
  ...imageProps
}) => {
  const id = media?.id || mediaId || undefined;
  const identity = [
    id || '',
    media?.src || '',
    media?.srcSet || '',
    media?.width || '',
    media?.height || '',
    media?.aspectRatio || '',
    media?.focalX || '',
    media?.focalY || '',
    media?.altText || '',
    fallbackSrc || ''
  ].join(':');
  const initial = useMemo<MediaPresentation | null>(() => {
    if (media) return media;
    if (!id && fallbackSrc) return presentationForFallback(fallbackSrc);
    return null;
  }, [identity]);
  const [resolved, setResolved] = useState<MediaPresentation | null>(initial);
  const [phase, setPhase] = useState<MediaImagePhase>(initial?.src ? 'loading' : id ? 'resolving' : 'failed');
  const [stateIdentity, setStateIdentity] = useState(identity);
  const [sourceKind, setSourceKind] = useState<MediaSourceKind>(id || media ? 'primary' : 'fallback');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const refreshAttemptedRef = useRef(false);
  const fallbackAttemptedRef = useRef(false);
  const generationRef = useRef(0);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const finishUnavailable = (): void => {
    setPhase('failed');
    onUnavailable?.();
  };

  const useFallbackSource = (generation: number): void => {
    if (generationRef.current !== generation) return;
    if (fallbackSrc && !fallbackAttemptedRef.current) {
      fallbackAttemptedRef.current = true;
      setResolved(presentationForFallback(fallbackSrc, media || resolved));
      setSourceKind('fallback');
      setLoadAttempt((current) => current + 1);
      setPhase('loading');
      return;
    }
    finishUnavailable();
  };

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    refreshAttemptedRef.current = false;
    fallbackAttemptedRef.current = false;
    setLoadAttempt(0);
    setStateIdentity(identity);

    if (media?.src) {
      setResolved(media);
      setSourceKind('primary');
      setPhase('loading');
      return;
    }

    if (id) {
      setResolved(media || null);
      setSourceKind('primary');
      setPhase('resolving');
      void mediaApi.get(id).then((result) => {
        if (generationRef.current !== generation) return;
        setResolved(result);
        setSourceKind('primary');
        setPhase('loading');
      }).catch(() => {
        useFallbackSource(generation);
      });
      return;
    }

    if (fallbackSrc) {
      fallbackAttemptedRef.current = true;
      setResolved(presentationForFallback(fallbackSrc, media));
      setSourceKind('fallback');
      setPhase('loading');
      return;
    }

    setResolved(null);
    setPhase('failed');
  }, [identity]);

  const refreshPrimarySource = async (): Promise<void> => {
    const generation = generationRef.current;
    if (!id || refreshAttemptedRef.current) {
      useFallbackSource(generation);
      return;
    }
    refreshAttemptedRef.current = true;
    setPhase('resolving');
    try {
      const refreshed = await mediaApi.get(id, true);
      if (generationRef.current !== generation) return;
      setResolved(refreshed);
      setSourceKind('primary');
      setLoadAttempt((current) => current + 1);
      setPhase('loading');
    } catch {
      useFallbackSource(generation);
    }
  };

  const handleImageError = (event: React.SyntheticEvent<HTMLImageElement>): void => {
    if (imageRef.current !== event.currentTarget) return;
    onError?.(event);
    if (sourceKind === 'primary' && id && !refreshAttemptedRef.current) {
      void refreshPrimarySource();
      return;
    }
    useFallbackSource(generationRef.current);
  };

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>): void => {
    onLoad?.(event);
    const image = event.currentTarget;
    setPhase('decoding');
    const reveal = (): void => {
      if (imageRef.current === image && image.naturalWidth > 0) {
        setPhase('ready');
      }
    };
    if (typeof image.decode !== 'function') {
      reveal();
      return;
    }
    void image.decode().then(reveal).catch(() => {
      // Some browsers reject decode() after a successful load. Decoded
      // dimensions are a safe signal that the image can still be displayed.
      if (image.complete && image.naturalWidth > 0) reveal();
      else handleImageError(event);
    });
  };

  // Effects run after render. Hide the previous identity synchronously so a
  // reused component can never flash the prior user's or post's image.
  const stateIsCurrent = stateIdentity === identity;
  const activePhase: MediaImagePhase = stateIsCurrent
    ? phase
    : (id || media?.src || fallbackSrc ? 'resolving' : 'failed');
  const activeResolved = stateIsCurrent ? resolved : null;

  if (activePhase === 'failed' || (!activeResolved?.src && !id && stateIsCurrent)) {
    return <>{fallback || <span data-media-state="failed" role="img" aria-label={alt || 'Image unavailable'} className={`flex h-full w-full items-center justify-center bg-gray-100 text-gray-400 ${className}`} style={style}><ImageOff size={20} aria-hidden="true" /></span>}</>;
  }

  const layoutMedia = stateIsCurrent ? activeResolved : initial;
  const aspectRatio = layoutMedia?.aspectRatio || (layoutMedia?.width && layoutMedia?.height ? layoutMedia.width / layoutMedia.height : undefined);
  const objectPosition = style?.objectPosition || (useFocalPoint && activeResolved?.focalX !== undefined && activeResolved?.focalY !== undefined
    ? `${activeResolved.focalX * 100}% ${activeResolved.focalY * 100}%`
    : undefined);
  const isReady = activePhase === 'ready';

  return (
    <span
      data-media-state={activePhase}
      aria-busy={!isReady}
      className={`relative block overflow-hidden ${className}`}
      style={{ ...style, aspectRatio }}
    >
      {!isReady && (
        <span data-testid="media-image-skeleton" aria-hidden="true" className="absolute inset-0 bg-gray-100 animate-pulse motion-reduce:animate-none" />
      )}
      {activeResolved?.src && (
        <img
          key={`${identity}:${activeResolved.src}:${loadAttempt}`}
          {...imageProps}
          ref={imageRef}
          src={activeResolved.src}
          srcSet={activeResolved.srcSet}
          sizes={sizes}
          width={activeResolved.width || undefined}
          height={activeResolved.height || undefined}
          alt={alt ?? activeResolved.altText ?? ''}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
          crossOrigin="anonymous"
          className={`h-full w-full transition-opacity duration-200 motion-reduce:transition-none ${isReady ? 'opacity-100' : 'opacity-0'}`}
          style={{ objectFit: objectFitFor(className, style?.objectFit), objectPosition }}
          onLoad={handleImageLoad}
          onError={handleImageError}
        />
      )}
    </span>
  );
};
