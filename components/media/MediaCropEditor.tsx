import React, { useEffect, useMemo, useRef, useState } from 'react';
import Cropper, { Area, MediaSize } from 'react-easy-crop';
import { Check, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MediaCropSelection, MediaPurpose } from '../../types';

type MediaCropEditorProps = {
  imageSrc: string;
  purpose: MediaPurpose;
  initialAspectRatio?: number;
  initialCrop?: MediaCropSelection;
  onApply: (selection: MediaCropSelection) => void;
  onCancel: () => void;
};

const MIN_RATIO = 0.8;
const MAX_RATIO = 1.91;

const fixedRatioForPurpose = (purpose: MediaPurpose): number | undefined =>
  ['PROFILE_AVATAR', 'GROUP_IMAGE', 'OPTION_IMAGE'].includes(purpose) ? 1 : undefined;

export const MediaCropEditor: React.FC<MediaCropEditorProps> = ({
  imageSrc,
  purpose,
  initialAspectRatio,
  initialCrop,
  onApply,
  onCancel
}) => {
  const { t } = useTranslation();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const fixedRatio = fixedRatioForPurpose(purpose);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [originalRatio, setOriginalRatio] = useState(initialAspectRatio || 1);
  const [aspectRatio, setAspectRatio] = useState(fixedRatio || initialAspectRatio || 1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(initialCrop ? {
    x: initialCrop.crop.x * 100,
    y: initialCrop.crop.y * 100,
    width: initialCrop.crop.width * 100,
    height: initialCrop.crop.height * 100
  } : null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const presets = useMemo(() => {
    if (fixedRatio) return [{ id: 'square', label: '1:1', ratio: 1 }];
    return [
      { id: 'original', label: t('media.crop.original', { defaultValue: 'Original' }), ratio: originalRatio },
      { id: 'square', label: '1:1', ratio: 1 },
      { id: 'portrait', label: '4:5', ratio: 0.8 },
      { id: 'wide', label: '1.91:1', ratio: 1.91 }
    ];
  }, [fixedRatio, originalRatio, t]);

  const reset = (): void => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAspectRatio(fixedRatio || initialAspectRatio || originalRatio);
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
      altText: initialCrop?.altText
    });
  };

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={t('media.crop.title', { defaultValue: 'Crop image' })}>
      <div className="safe-top flex h-16 shrink-0 items-center justify-between px-4">
        <button ref={closeButtonRef} type="button" onClick={onCancel} className="p-2 text-white hover:bg-white/10 rounded-full" title={t('common.cancel', { defaultValue: 'Cancel' })} aria-label={t('common.cancel', { defaultValue: 'Cancel' })}>
          <X size={24} />
        </button>
        <h2 className="text-base font-semibold text-white">{t('media.crop.title', { defaultValue: 'Crop image' })}</h2>
        <button type="button" onClick={apply} disabled={!croppedArea} className="p-2 text-white hover:bg-white/10 rounded-full disabled:opacity-40" title={t('common.apply', { defaultValue: 'Apply' })} aria-label={t('common.apply', { defaultValue: 'Apply' })}>
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
          restrictPosition
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(area) => setCroppedArea(area)}
          onMediaLoaded={(size: MediaSize) => {
            const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, size.naturalWidth / size.naturalHeight));
            setOriginalRatio(ratio);
            if (!fixedRatio && !initialAspectRatio) setAspectRatio(ratio);
          }}
        />
      </div>

      <div className="safe-bottom shrink-0 border-t border-white/10 bg-black px-4 py-4">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <button type="button" onClick={reset} className="p-2 text-gray-300 hover:text-white rounded-full" title={t('media.crop.reset', { defaultValue: 'Reset' })} aria-label={t('media.crop.reset', { defaultValue: 'Reset' })}>
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
      </div>
    </div>
  );
};
