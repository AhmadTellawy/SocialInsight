import React, { useEffect, useMemo, useRef, useState } from 'react';
import Cropper, { Area, MediaSize } from 'react-easy-crop';
import { Check, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MediaCropSelection, MediaPurpose } from '../../types';

type MediaCropEditorProps = {
  imageSrc: string;
  purpose: MediaPurpose;
  initialAspectRatio?: number;
  lockedAspectRatio?: number;
  initialCrop?: MediaCropSelection;
  onApply: (selection: MediaCropSelection) => void;
  onCancel: () => void;
};

const MIN_RATIO = 0.8;
const MAX_RATIO = 1.91;

const fixedRatioForPurpose = (purpose: MediaPurpose): number | undefined =>
  purpose === 'PROFILE_COVER'
    ? 3
    : ['PROFILE_AVATAR', 'GROUP_IMAGE', 'OPTION_IMAGE'].includes(purpose) ? 1 : undefined;

export const MediaCropEditor: React.FC<MediaCropEditorProps> = ({
  imageSrc,
  purpose,
  initialAspectRatio,
  lockedAspectRatio,
  initialCrop,
  onApply,
  onCancel
}) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const fixedRatio = fixedRatioForPurpose(purpose) || lockedAspectRatio;
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [sourceRatio, setSourceRatio] = useState<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState(fixedRatio || initialAspectRatio || 1);
  const [altText, setAltText] = useState(initialCrop?.altText || '');
  const [croppedArea, setCroppedArea] = useState<Area | null>(initialCrop ? {
    x: initialCrop.crop.x * 100,
    y: initialCrop.crop.y * 100,
    width: initialCrop.crop.width * 100,
    height: initialCrop.crop.height * 100
  } : null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )) as HTMLElement[];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [onCancel]);

  const presets = useMemo(() => {
    if (fixedRatio) return [{
      id: 'fixed',
      label: Math.abs(fixedRatio - 1) < 0.001 ? '1:1' : Math.abs(fixedRatio - 3) < 0.001 ? '3:1' : fixedRatio.toFixed(2),
      ratio: fixedRatio
    }];
    return [
      ...(sourceRatio !== null && sourceRatio >= MIN_RATIO && sourceRatio <= MAX_RATIO
        ? [{ id: 'original', label: t('media.crop.original', { defaultValue: 'Original' }), ratio: sourceRatio }]
        : []),
      { id: 'square', label: '1:1', ratio: 1 },
      { id: 'portrait', label: '4:5', ratio: 0.8 },
      { id: 'wide', label: '1.91:1', ratio: 1.91 }
    ];
  }, [fixedRatio, sourceRatio, t]);

  const reset = (): void => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAspectRatio(fixedRatio || initialAspectRatio || Math.min(MAX_RATIO, Math.max(MIN_RATIO, sourceRatio || 1)));
  };

  const apply = (): void => {
    if (!croppedArea) return;
    const normalized = {
      x: croppedArea.x / 100,
      y: croppedArea.y / 100,
      width: croppedArea.width / 100,
      height: croppedArea.height / 100
    };
    onApply({
      aspectRatio,
      crop: normalized,
      focalX: normalized.x + normalized.width / 2,
      focalY: normalized.y + normalized.height / 2,
      altText: altText.trim() || undefined
    });
  };

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[120] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={t(purpose === 'PROFILE_COVER' ? 'profile.cover.cropTitle' : 'media.crop.title', { defaultValue: purpose === 'PROFILE_COVER' ? 'Crop cover photo' : 'Crop image' })}>
      <div className="safe-top flex h-16 shrink-0 items-center justify-between px-4">
        <button ref={closeButtonRef} type="button" onClick={onCancel} className="flex h-11 w-11 items-center justify-center text-white hover:bg-white/10 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" title={t('common.cancel', { defaultValue: 'Cancel' })} aria-label={t('common.cancel', { defaultValue: 'Cancel' })}>
          <X size={24} />
        </button>
        <h2 className="text-base font-semibold text-white">{t(purpose === 'PROFILE_COVER' ? 'profile.cover.cropTitle' : 'media.crop.title', { defaultValue: purpose === 'PROFILE_COVER' ? 'Crop cover photo' : 'Crop image' })}</h2>
        <button type="button" onClick={apply} disabled={!croppedArea} className="flex h-11 w-11 items-center justify-center text-white hover:bg-white/10 rounded-full disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" title={t('common.apply', { defaultValue: 'Apply' })} aria-label={t('common.apply', { defaultValue: 'Apply' })}>
          <Check size={24} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 touch-none">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspectRatio}
          minZoom={1}
          maxZoom={4}
          zoomSpeed={0.2}
          showGrid
          cropShape={purpose === 'PROFILE_AVATAR' ? 'round' : 'rect'}
          restrictPosition
          initialCroppedAreaPercentages={initialCrop ? {
            x: initialCrop.crop.x * 100,
            y: initialCrop.crop.y * 100,
            width: initialCrop.crop.width * 100,
            height: initialCrop.crop.height * 100
          } : undefined}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(area) => setCroppedArea(area)}
          onMediaLoaded={(size: MediaSize) => {
            const ratio = size.naturalWidth / size.naturalHeight;
            setSourceRatio(ratio);
            if (!fixedRatio && !initialAspectRatio) {
              setAspectRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)));
            }
          }}
        />
      </div>

      <div className="safe-bottom shrink-0 border-t border-white/10 bg-black px-4 py-4">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <button type="button" onClick={reset} className="flex h-11 w-11 items-center justify-center text-gray-300 hover:text-white rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" title={t('media.crop.reset', { defaultValue: 'Reset' })} aria-label={t('media.crop.reset', { defaultValue: 'Reset' })}>
            <RefreshCw size={20} />
          </button>
          <input
            type="range"
            min="1"
            max="4"
            step="0.01"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="min-w-0 flex-1 accent-blue-500"
            aria-label={t('media.crop.zoom', { defaultValue: 'Zoom' })}
          />
          <span className="w-10 text-end text-xs tabular-nums text-gray-400">{zoom.toFixed(1)}x</span>
        </div>
        <div className="mx-auto mt-4 flex max-w-lg justify-center gap-2" role="group" aria-label={t('media.crop.aspect', { defaultValue: 'Aspect ratio' })}>
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setAspectRatio(preset.ratio)}
              className={`h-9 rounded-md border px-3 text-xs font-medium ${Math.abs(aspectRatio - preset.ratio) < 0.001 ? 'border-white bg-white text-black' : 'border-white/25 text-gray-300 hover:border-white/60'}`}
              aria-pressed={Math.abs(aspectRatio - preset.ratio) < 0.001}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="mx-auto mt-3 max-w-lg">
          <label htmlFor="media-alt-text" className="sr-only">{t('media.crop.altText', { defaultValue: 'Image description' })}</label>
          <input
            id="media-alt-text"
            type="text"
            value={altText}
            maxLength={300}
            onChange={(event) => setAltText(event.target.value)}
            placeholder={t('media.crop.altTextPlaceholder', { defaultValue: 'Image description (optional)' })}
            className="h-10 w-full rounded-md border border-white/20 bg-white/10 px-3 text-sm text-white placeholder:text-gray-400 outline-none focus:border-white/60"
          />
        </div>
      </div>
    </div>
  );
};
