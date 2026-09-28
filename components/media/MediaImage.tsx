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

type SourceKind = 'primary' | 'fallback';

const fallbackPresentation = (src: string, media?: MediaPresentation | null): MediaPresentation => ({
  id: '', access: 'PUBLIC', aspectRatio: media?.aspectRatio || 0,
  width: media?.width || 0, height: media?.height || 0, src
});

const objectFitFor = (className: string, explicit?: React.CSSProperties['objectFit']): React.CSSProperties['objectFit'] => {
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
    id || '', media?.src || '', media?.srcSet || '', media?.width || '',
    media?.height || '', media?.aspectRatio || '', media?.focalX ?? '',
    media?.focalY ?? '', media?.altText || '', fallbackSrc || ''
  ].join(':');
  const initial = useMemo<MediaPresentation | null>(() => {
    if (media?.src) return media;
    if (!id && fallbackSrc) return fallbackPresentation(fallbackSrc, media);
    return null;
  }, [identity]);
  const [resolved, setResolved] = useState<MediaPresentation | null>(initial);
  const [phase, setPhase] = useState<MediaImagePhase>(initial?.src ? 'loading' : id ? 'resolving' : 'failed');
  const [stateIdentity, setStateIdentity] = useState(identity);
  const [sourceKind, setSourceKind] = useState<SourceKind>(id || media ? 'primary' : 'fallback');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [naturalAspectRatio, setNaturalAspectRatio] = useState<number | null>(null);
  const refreshAttemptedRef = useRef(false);
  const fallbackAttemptedRef = useRef(false);
  const unavailableReportedRef = useRef(false);
  const generationRef = useRef(0);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const finishUnavailable = (): void => {
    setPhase('failed');
    if (!unavailableReportedRef.current) {
      unavailableReportedRef.current = true;
      onUnavailable?.();
    }
  };

  const useFallbackSource = (generation: number, dimensions?: MediaPresentation | null): void => {
    if (generationRef.current !== generation) return;
    if (fallbackSrc && !fallbackAttemptedRef.current) {
      fallbackAttemptedRef.current = true;
      setNaturalAspectRatio(null);
      setResolved(fallbackPresentation(fallbackSrc, dimensions || media));
      setSourceKind('fallback');
      setLoadAttempt((current) => current + 1);
      setPhase('loading');
      return;
    }
    finishUnavailable();
  };

  useEffect(() => {
    const generation = ++generationRef.current;
    refreshAttemptedRef.current = false;
    fallbackAttemptedRef.current = false;
    unavailableReportedRef.current = false;
    setLoadAttempt(0);
    setNaturalAspectRatio(null);
    setStateIdentity(identity);

    if (media?.src) {
      setResolved(media);
      setSourceKind('primary');
      setPhase('loading');
    } else if (id) {
      setResolved(null);
      setSourceKind('primary');
      setPhase('resolving');
      void mediaApi.get(id).then((result) => {
        if (generationRef.current !== generation) return;
        if (!result.src) {
          useFallbackSource(generation, result);
          return;
        }
        setResolved(result);
        setSourceKind('primary');
        setPhase('loading');
      }).catch(() => useFallbackSource(generation));
    } else if (fallbackSrc) {
      fallbackAttemptedRef.current = true;
      setResolved(fallbackPresentation(fallbackSrc, media));
      setSourceKind('fallback');
      setPhase('loading');
    } else {
      setResolved(null);
      setPhase('failed');
    }

    return () => { generationRef.current += 1; };
  }, [identity]);

  const refreshPrimarySource = async (): Promise<void> => {
    const generation = generationRef.current;
    if (!id || refreshAttemptedRef.current) {
      useFallbackSource(generation, resolved);
      return;
    }
    refreshAttemptedRef.current = true;
    setPhase('resolving');
    try {
      const refreshed = await mediaApi.get(id, true);
      if (generationRef.current !== generation) return;
      if (!refreshed.src) {
        useFallbackSource(generation, refreshed);
        return;
      }
      setResolved(refreshed);
      setSourceKind('primary');
      setNaturalAspectRatio(null);
      setLoadAttempt((current) => current + 1);
      setPhase('loading');
    } catch {
      useFallbackSource(generation, resolved);
    }
  };

  const handleImageFailure = (image: HTMLImageElement, event?: React.SyntheticEvent<HTMLImageElement>): void => {
    if (imageRef.current !== image) return;
    if (event) onError?.(event);
    if (sourceKind === 'primary' && id && !refreshAttemptedRef.current) {
      void refreshPrimarySource();
      return;
    }
    useFallbackSource(generationRef.current, resolved);
  };

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>): void => {
    const image = event.currentTarget;
    if (imageRef.current !== image) return;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setNaturalAspectRatio(image.naturalWidth / image.naturalHeight);
    }
    onLoad?.(event);
    setPhase('decoding');
    const reveal = (): void => {
      if (imageRef.current === image && image.naturalWidth > 0) setPhase('ready');
    };
    if (typeof image.decode !== 'function') {
      reveal();
      return;
    }
    void image.decode().then(reveal).catch(() => {
      if (image.complete && image.naturalWidth > 0) reveal();
      else handleImageFailure(image);
    });
  };

  // Effects run after render. Hide the previous source during the render
  // that changes identity, before the old image can appear in a reused card.
  const stateIsCurrent = stateIdentity === identity;
  const activePhase: MediaImagePhase = stateIsCurrent ? phase : id || media?.src || fallbackSrc ? 'resolving' : 'failed';
  const activeResolved = stateIsCurrent ? resolved : null;

  if (activePhase === 'failed') {
    return <>{fallback || <span data-media-state="failed" role="img" aria-label={alt || 'Image unavailable'} className={`flex h-full w-full items-center justify-center bg-gray-100 text-gray-400 ${className}`} style={style}><ImageOff size={20} aria-hidden="true" /></span>}</>;
  }

  // Fixed-size callers keep their frame. Fluid h-auto content can use the
  // resolved dimensions while the skeleton still masks loading and decoding.
  const fluidHeight = /(?:^|\s)h-auto(?:\s|$)/.test(className)
    && !style?.height && !style?.aspectRatio
    && !/(?:^|\s)aspect-(?!auto)(?:\S+)/.test(className);
  const mediaRatio = media?.aspectRatio || (media?.width && media?.height ? media.width / media.height : 0);
  const resolvedRatio = activeResolved?.aspectRatio
    || (activeResolved?.width && activeResolved?.height ? activeResolved.width / activeResolved.height : 0);
  const loadedRatio = stateIsCurrent ? naturalAspectRatio : null;
  const aspectRatio = fluidHeight
    ? (sourceKind === 'fallback' ? loadedRatio || resolvedRatio || mediaRatio || 1 : resolvedRatio || mediaRatio || loadedRatio || 1)
    : mediaRatio || 1;
  const objectPosition = style?.objectPosition || (useFocalPoint && activeResolved?.focalX !== undefined && activeResolved?.focalY !== undefined
    ? `${activeResolved.focalX * 100}% ${activeResolved.focalY * 100}%` : undefined);
  const isReady = activePhase === 'ready';
  return (
    <span data-media-state={activePhase} aria-busy={!isReady} className={`relative block overflow-hidden ${className}`} style={{ ...style, aspectRatio: style?.aspectRatio || aspectRatio }}>
      {!isReady && <span data-testid="media-image-skeleton" aria-hidden="true" className="absolute inset-0 bg-gray-100 animate-pulse motion-reduce:animate-none" />}
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
          className={`absolute inset-0 h-full w-full transition-opacity duration-200 motion-reduce:transition-none ${isReady ? 'opacity-100' : 'opacity-0'}`}
          style={{ objectFit: objectFitFor(className, style?.objectFit), objectPosition }}
          onLoad={handleImageLoad}
          onError={(event) => handleImageFailure(event.currentTarget, event)}
        />
      )}
    </span>
  );
};
