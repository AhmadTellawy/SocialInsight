import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { MediaPresentation } from '../../types';
import { mediaApi } from '../../services/mediaApi';
import { interactionGeneration,subscribeInteractions } from '../../utils/interactionCache';
import { acquireProtectedImage, imageRequestWidth } from '../../services/protectedImages';

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
  const epoch=React.useSyncExternalStore(subscribeInteractions,interactionGeneration);
  const [frame,setFrame] = useState<HTMLElement|null>(null);
  const [visible,setVisible] = useState(eager);
  useEffect(()=>{
    if(!frame)return;
    if(typeof IntersectionObserver === 'undefined'){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{rootMargin:'200px'});
    observer.observe(frame);return()=>observer.disconnect();
  },[frame]);
  const id = media?.id || mediaId || undefined;
  const identity = `${epoch}:${id || ''}:${media?.src || ''}:${fallbackSrc || ''}`;
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
    if (visible && id && !initial?.src) {
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
  }, [identity, id, initial, visible]);

  useEffect(() => {
    setProtectedImage(null);
    if (!visible || !resolved?.requiresAuth || !resolved.src || !id) return;
    const source=resolved.src;
    const pixels=sizes?.match(/^(\d+)px$/)?.[1];
    const displayWidth=pixels?Number(pixels):frame?.getBoundingClientRect().width || Math.min(window.innerWidth,448);
    return acquireProtectedImage(id,source,imageRequestWidth(displayWidth,window.devicePixelRatio),view=>{
      setProtectedImage(view.url?{identity,source,url:view.url}:null);setFailed(view.failed);
      if(view.failed)onUnavailable?.();
    });
  },[visible,resolved?.requiresAuth,resolved?.src,identity,id,sizes]);

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

  if ((!visible && (id || resolved?.requiresAuth)) || loading || (resolved?.requiresAuth && !protectedSrc && !failed)) {
    return <span ref={setFrame} aria-busy="true" style={{...style,aspectRatio:style?.aspectRatio || resolved?.aspectRatio || 1}} className={`flex h-full w-full animate-pulse items-center justify-center bg-gray-100 text-gray-300 ${imageProps.className || ''}`}><ImageOff size={20} aria-hidden="true" /></span>;
  }

  if (failed || !resolved?.src) {
    return <>{fallback || <span role="img" aria-label={alt || 'Image unavailable'} className="flex h-full w-full items-center justify-center bg-gray-100 text-gray-400"><ImageOff size={20} aria-hidden="true" /></span>}</>;
  }

  return (
    <img
      ref={setFrame}
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
