import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MediaPresentation } from '../../types';
import { MediaImage } from './MediaImage';

type MediaCarouselProps = {
  media: MediaPresentation[];
  className?: string;
  eager?: boolean;
  onClick?: () => void;
};

export const MediaCarousel: React.FC<MediaCarouselProps> = ({ media, className = '', eager = false, onClick }) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const items = media.slice(0, 8);
  const aspectRatio = Math.max(0.8, Math.min(1.91, items[0]?.aspectRatio || 1));

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (items.length === 0) return null;

  const goTo = (nextIndex: number): void => {
    const bounded = Math.max(0, Math.min(items.length - 1, nextIndex));
    const child = containerRef.current?.children[bounded] as HTMLElement | undefined;
    child?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    setIndex(bounded);
  };

  return (
    <div
      className={`group relative w-full overflow-hidden bg-gray-100 ${className}`}
      style={{ aspectRatio }}
      onClick={onClick}
      onKeyDown={(event) => {
        const rtl = document.documentElement.dir === 'rtl';
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          goTo(index + (rtl ? 1 : -1));
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          goTo(index + (rtl ? -1 : 1));
        } else if ((event.key === 'Enter' || event.key === ' ') && onClick) {
          event.preventDefault();
          onClick();
        }
      }}
      tabIndex={items.length > 1 || onClick ? 0 : undefined}
      role="region"
      aria-roledescription="carousel"
      aria-label={t('media.carousel.label', { defaultValue: 'Post images' })}
    >
      <div
        ref={containerRef}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(event) => {
          const element = event.currentTarget;
          const children = Array.from(element.children) as HTMLElement[];
          if (children.length === 0) return;
          const center = element.getBoundingClientRect().left + element.clientWidth / 2;
          let closest = 0;
          let distance = Number.POSITIVE_INFINITY;
          children.forEach((child, childIndex) => {
            const rect = child.getBoundingClientRect();
            const currentDistance = Math.abs(rect.left + rect.width / 2 - center);
            if (currentDistance < distance) {
              closest = childIndex;
              distance = currentDistance;
            }
          });
          setIndex(closest);
        }}
      >
        {items.map((item, itemIndex) => (
          <div key={item.id} className="h-full w-full shrink-0 snap-start" role="group" aria-roledescription="slide" aria-label={`${itemIndex + 1} / ${items.length}`}>
            <MediaImage media={item} eager={eager && itemIndex === 0} sizes="(max-width: 768px) 100vw, 680px" className="h-full w-full object-cover" alt={item.altText || ''} />
          </div>
        ))}
      </div>

      {items.length > 1 && (
        <>
          <button type="button" onClick={(event) => { event.stopPropagation(); goTo(index - 1); }} disabled={index === 0} className="absolute start-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/70 disabled:hidden group-hover:opacity-100 sm:flex" aria-label={t('media.carousel.previous', { defaultValue: 'Previous image' })} title={t('media.carousel.previous', { defaultValue: 'Previous image' })}>
            <ChevronLeft className="rtl:rotate-180" size={20} />
          </button>
          <button type="button" onClick={(event) => { event.stopPropagation(); goTo(index + 1); }} disabled={index === items.length - 1} className="absolute end-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/70 disabled:hidden group-hover:opacity-100 sm:flex" aria-label={t('media.carousel.next', { defaultValue: 'Next image' })} title={t('media.carousel.next', { defaultValue: 'Next image' })}>
            <ChevronRight className="rtl:rotate-180" size={20} />
          </button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/45 px-2 py-1" aria-label={`${index + 1} / ${items.length}`}>
            {items.map((item, dotIndex) => <button type="button" key={item.id} onClick={(event) => { event.stopPropagation(); goTo(dotIndex); }} className={`h-1.5 w-1.5 rounded-full ${dotIndex === index ? 'bg-white' : 'bg-white/45'}`} aria-label={t('media.carousel.goTo', { defaultValue: 'Go to image {{index}}', index: dotIndex + 1 })} aria-current={dotIndex === index ? 'true' : undefined} />)}
          </div>
        </>
      )}
    </div>
  );
};
