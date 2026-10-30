import React, { useEffect, useRef, useState } from 'react';
import type { MediaCropSelection } from '../../types';
import { moveSourceCrop } from '../../utils/mediaCrop';

type Props = {
  src: string; selection: MediaCropSelection; className?: string;
  onChange?: (crop: MediaCropSelection) => void; label?: string;
};

/** A viewport over the original URL. Never creates or reuses a cropped bitmap. */
export function MediaSourcePreview({ src, selection, className = '', onChange, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const drag = useRef<{ x: number; y: number; selection: MediaCropSelection } | null>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = Math.min(size.width, size.height * selection.aspectRatio);
  const height = width / selection.aspectRatio;
  const { crop } = selection;
  return (
    <div ref={host} className={`flex h-full w-full items-center justify-center overflow-hidden ${className}`}>
      <div
        data-testid="source-crop" data-crop={JSON.stringify(crop)} data-ratio={selection.aspectRatio}
        className={`relative shrink-0 overflow-hidden ${onChange ? 'touch-none cursor-move focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500' : ''}`}
        style={{ width, height }} role={onChange ? 'group' : undefined} aria-label={onChange ? label : undefined}
        tabIndex={onChange ? 0 : undefined}
        onPointerDown={onChange ? event => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, selection };
        } : undefined}
        onPointerMove={onChange ? event => {
          const start = drag.current;
          if (!start || !width || !height) return;
          onChange(moveSourceCrop(start.selection, -(event.clientX - start.x) * start.selection.crop.width / width, -(event.clientY - start.y) * start.selection.crop.height / height));
        } : undefined}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onKeyDown={onChange ? event => {
          const direction = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] }[event.key];
          if (direction) { event.preventDefault(); onChange(moveSourceCrop(selection, direction[0], direction[1])); }
        } : undefined}
      >
        <img src={src} alt="" draggable={false} className="pointer-events-none absolute select-none"
          style={{ maxWidth: 'none', width: `${100 / crop.width}%`, height: `${100 / crop.height}%`, left: `${-100 * crop.x / crop.width}%`, top: `${-100 * crop.y / crop.height}%` }} />
      </div>
    </div>
  );
}
