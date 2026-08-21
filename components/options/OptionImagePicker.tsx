import React, { useRef } from 'react';
import { Camera, Pencil, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MediaDraft } from '../../types';
import { reconcileOptionMediaDrafts, OptionWithMediaDrafts } from '../../utils/optionPresentation';
import { MediaPicker, MediaPickerControls } from '../media/MediaPicker';
import { MediaImage } from '../media/MediaImage';

export type OptionImagePickerControls = MediaPickerControls & {
  openBulk: () => void;
  openForOption: (optionId: string) => void;
};

type OptionImagePickerProps<T extends OptionWithMediaDrafts> = {
  options: T[];
  onChange: (options: T[]) => void;
  createOption: () => T;
  children: (controls: OptionImagePickerControls) => React.ReactNode;
};

export const OptionImagePicker = <T extends OptionWithMediaDrafts>({
  options,
  onChange,
  createOption,
  children
}: OptionImagePickerProps<T>) => {
  const preferredOptionId = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const mediaDrafts = options.flatMap((option) => option.mediaDrafts.slice(0, 1));

  return (
    <MediaPicker
      purpose="OPTION_IMAGE"
      value={mediaDrafts}
      onChange={(nextDrafts) => {
        const nextOptions = reconcileOptionMediaDrafts(optionsRef.current, nextDrafts, createOption, preferredOptionId.current);
        optionsRef.current = nextOptions;
        onChange(nextOptions);
        preferredOptionId.current = null;
      }}
      maxFiles={Number.MAX_SAFE_INTEGER}
      multiple
      showAddButton={false}
      renderContent={(controls) => children({
        ...controls,
        openBulk: () => {
          preferredOptionId.current = null;
          controls.open();
        },
        openForOption: (optionId) => {
          preferredOptionId.current = optionId;
          controls.open();
        }
      })}
    />
  );
};

type OptionImageThumbnailProps = {
  optionId: string;
  optionIndex: number;
  draft?: MediaDraft;
  legacyImage?: string | null;
  controls: OptionImagePickerControls;
  accent?: 'blue' | 'purple' | 'amber';
};

const accentClasses = {
  blue: 'border-blue-400 text-blue-600',
  purple: 'border-purple-400 text-purple-600',
  amber: 'border-amber-400 text-amber-700'
};

export const OptionImageThumbnail: React.FC<OptionImageThumbnailProps> = ({
  optionId,
  optionIndex,
  draft,
  legacyImage,
  controls,
  accent = 'blue'
}) => {
  const { t } = useTranslation();
  const hasImage = Boolean(draft || legacyImage);
  const busy = Boolean(draft && controls.isBusy(draft.clientId));
  const label = hasImage
    ? t('answerType.replaceOptionImage', { number: optionIndex + 1 })
    : t('answerType.addOptionImage', { number: optionIndex + 1 });

  return (
    <div className="relative h-12 w-12 shrink-0">
      <button
        type="button"
        disabled={busy}
        aria-label={draft?.status === 'error' ? t('common.retry') : label}
        title={draft?.status === 'error' ? t('common.retry') : label}
        aria-busy={busy}
        onClick={() => {
          if (draft?.status === 'error') controls.retry(draft.clientId);
          else if (draft) controls.replace(draft.clientId);
          else controls.openForOption(optionId);
        }}
        className={`relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-dashed bg-gray-50 transition-colors disabled:cursor-wait ${
          hasImage ? accentClasses[accent] : 'border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600'
        }`}
      >
        {draft?.status === 'ready' && draft.presentation ? (
          <MediaImage media={draft.presentation} mediaId={draft.assetId} className="h-full w-full object-cover" alt="" />
        ) : draft?.previewUrl ? (
          <img src={draft.previewUrl} className="h-full w-full object-cover" alt="" />
        ) : legacyImage ? (
          <img src={legacyImage} className="h-full w-full object-cover" alt="" />
        ) : (
          <Camera size={16} aria-hidden="true" />
        )}
        {busy && (
          <span className="absolute inset-0 flex items-end bg-black/30" aria-hidden="true">
            <span className="h-1 bg-blue-500" style={{ width: `${draft?.status === 'processing' ? 100 : draft?.progress || 0}%` }} />
          </span>
        )}
        {draft?.status === 'error' && (
          <span className="absolute inset-0 flex items-center justify-center bg-red-600/75 text-white" aria-hidden="true">
            <RefreshCw size={16} />
          </span>
        )}
      </button>
      {draft?.file && !busy && draft.status !== 'error' && (
        <button
          type="button"
          onClick={() => controls.edit(draft.clientId)}
          className="absolute -bottom-1 -end-1 flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm hover:text-blue-600"
          aria-label={t('answerType.editOptionCrop', { number: optionIndex + 1 })}
          title={t('answerType.editCrop')}
        >
          <Pencil size={11} aria-hidden="true" />
        </button>
      )}
      {draft && !busy && (
        <button
          type="button"
          onClick={() => controls.remove(draft.clientId)}
          className="absolute -end-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm hover:text-red-600"
          aria-label={t('common.remove')}
          title={t('common.remove')}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
