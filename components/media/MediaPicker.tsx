import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ImagePlus, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MediaCropSelection, MediaDraft, MediaPurpose } from '../../types';
import { MediaUploadError, mediaApi } from '../../services/mediaApi';
import { mediaUploadScheduler } from '../../utils/mediaUploadScheduler';
import { mediaUploadRegistry } from '../../utils/mediaUploadRegistry';
import { MediaCropEditor } from './MediaCropEditor';
import { MediaImage } from './MediaImage';

export type MediaPickerHandle = {
  open: () => void;
};

export type MediaPickerControls = {
  open: () => void;
  edit: (clientId: string) => void;
  replace: (clientId: string) => void;
  retry: (clientId: string) => void;
  remove: (clientId: string) => void;
  isBusy: (clientId: string) => boolean;
  canSelect: boolean;
  busy: boolean;
};

type MediaPickerProps = {
  purpose: MediaPurpose;
  value: MediaDraft[];
  onChange: (value: MediaDraft[]) => void;
  maxFiles?: number;
  multiple?: boolean;
  aspectRatio?: number;
  onAspectRatioChange?: (ratio: number) => void;
  disabled?: boolean;
  className?: string;
  showAddButton?: boolean;
  renderContent?: (controls: MediaPickerControls) => React.ReactNode;
};

const DEFAULT_MAX_INPUT_BYTES = 15 * 1024 * 1024;
const COVER_MAX_INPUT_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const fixedRatioForPurpose = (purpose: MediaPurpose): number | undefined => {
  if (purpose === 'PROFILE_COVER') return 3;
  if (['PROFILE_AVATAR', 'GROUP_IMAGE', 'OPTION_IMAGE'].includes(purpose)) return 1;
  return undefined;
};

const loadImageRatio = (url: string): Promise<number> => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image.naturalWidth / image.naturalHeight);
  image.onerror = () => reject(new Error('Image could not be opened.'));
  image.src = url;
});

type SortableTileProps = {
  draft: MediaDraft;
  index: number;
  sortable: boolean;
  onEdit: () => void;
  onRetry: () => void;
  onRemove: () => void;
};

const SortableTile: React.FC<SortableTileProps> = ({ draft, index, sortable, onEdit, onRetry, onRemove }) => {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: draft.clientId, disabled: !sortable });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`relative h-28 w-28 shrink-0 overflow-hidden rounded-md border bg-gray-100 ${isDragging ? 'z-10 border-blue-500 opacity-80 shadow-lg' : 'border-gray-200'}`}>
      {draft.previewUrl ? (
        <img src={draft.previewUrl} alt="" className="h-full w-full object-cover" />
      ) : draft.presentation ? (
        <MediaImage media={draft.presentation} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-gray-100" />
      )}
      <span className="absolute start-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/60 px-1 text-[10px] font-semibold text-white">{index + 1}</span>
      {sortable && (
        <button type="button" {...attributes} {...listeners} className="absolute end-1 top-1 flex h-7 w-7 touch-none items-center justify-center rounded-full bg-black/60 text-white" aria-label={t('media.reorder', { defaultValue: 'Reorder image' })} title={t('media.reorder', { defaultValue: 'Reorder image' })}>
          <GripVertical size={16} />
        </button>
      )}
      {(draft.status === 'uploading' || draft.status === 'processing' || draft.status === 'queued') && (
        <div className="absolute inset-0 flex items-end bg-black/45">
          <div className="h-1.5 bg-blue-500 transition-[width]" style={{ width: `${draft.status === 'processing' ? 100 : draft.progress}%` }} />
          <span className="sr-only">{draft.status === 'processing' ? t('media.processing', { defaultValue: 'Processing image' }) : `${draft.progress}%`}</span>
        </div>
      )}
      <div className="absolute bottom-1 end-1 flex gap-1">
        {draft.status === 'error' ? (
          <button type="button" onClick={onRetry} className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-red-600 shadow" aria-label={t('common.retry', { defaultValue: 'Retry' })} title={t('common.retry', { defaultValue: 'Retry' })}><RefreshCw size={15} /></button>
        ) : (
          <button type="button" onClick={onEdit} disabled={!draft.file || ['uploading', 'processing', 'queued'].includes(draft.status)} className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-gray-700 shadow disabled:hidden" aria-label={t('common.edit', { defaultValue: 'Edit' })} title={t('common.edit', { defaultValue: 'Edit' })}><Pencil size={14} /></button>
        )}
        <button type="button" onClick={onRemove} className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-gray-700 shadow" aria-label={t('common.remove', { defaultValue: 'Remove' })} title={t('common.remove', { defaultValue: 'Remove' })}><Trash2 size={14} /></button>
      </div>
    </div>
  );
};

export const MediaPicker = forwardRef<MediaPickerHandle, MediaPickerProps>(({
  purpose,
  value,
  onChange,
  maxFiles = 1,
  multiple = false,
  aspectRatio,
  onAspectRatioChange,
  disabled = false,
  className = '',
  showAddButton = true,
  renderContent
}, ref) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const valuesRef = useRef(value);
  const previewUrls = useRef(new Set<string>());
  const replacedPersistedDrafts = useRef<MediaDraft[] | null>(null);
  const pendingReplacements = useRef(new Map<string, MediaDraft>());
  const [activeEditorId, setActiveEditorId] = useState<string | null>(null);
  const [replacementTargetId, setReplacementTargetId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useImperativeHandle(ref, () => ({
    open: () => {
      if (!disabled) {
        setReplacementTargetId(null);
        inputRef.current?.click();
      }
    }
  }), [disabled]);

  useEffect(() => { valuesRef.current = value; }, [value]);
  useEffect(() => {
    const retainedUrls = new Set(value.map((draft) => draft.previewUrl).filter(Boolean));
    previewUrls.current.forEach((url) => {
      if (!retainedUrls.has(url)) {
        URL.revokeObjectURL(url);
        previewUrls.current.delete(url);
      }
    });
  }, [value]);
  const publish = (next: MediaDraft[]): void => {
    valuesRef.current = next;
    onChange(next);
  };

  const patchDraft = (clientId: string, patch: Partial<MediaDraft>): void => {
    publish(valuesRef.current.map((draft) => draft.clientId === clientId ? { ...draft, ...patch } : draft));
  };

  const continueEditing = (excludingId: string): void => {
    const next = valuesRef.current.find((draft) => draft.clientId !== excludingId && draft.status === 'editing');
    setActiveEditorId(next?.clientId || null);
  };

  const releaseTransientDraft = (draft: MediaDraft): void => {
    mediaUploadRegistry.cancel(draft.clientId);
    if (draft.assetId && !draft.persisted) void mediaApi.cancel(draft.assetId).catch(() => undefined);
    if (draft.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(draft.previewUrl);
      previewUrls.current.delete(draft.previewUrl);
    }
  };

  const completePendingReplacement = (draft: MediaDraft): void => {
    const replacedDraft = pendingReplacements.current.get(draft.clientId) || draft.replacedDraft;
    if (!replacedDraft) return;
    if (!replacedDraft.persisted) releaseTransientDraft(replacedDraft);
    pendingReplacements.current.delete(draft.clientId);
  };

  const startUpload = (draft: MediaDraft, crop: MediaCropSelection): void => {
    if (!draft.file) return;
    const controller = mediaUploadRegistry.create(draft.clientId);
    patchDraft(draft.clientId, { status: 'queued', progress: 0, crop, error: undefined });
    void mediaUploadScheduler.schedule(async () => {
      if (!mediaUploadRegistry.isActive(draft.clientId, controller)) return;
      patchDraft(draft.clientId, { status: 'uploading' });
      try {
        const result = await mediaApi.upload(
          draft.file!,
          draft.purpose,
          crop,
          (progress) => {
            if (mediaUploadRegistry.isActive(draft.clientId, controller)) {
              patchDraft(draft.clientId, { progress, status: progress >= 100 ? 'processing' : 'uploading' });
            }
          },
          controller.signal
        );
        if (!mediaUploadRegistry.isActive(draft.clientId, controller)) return;
        if (draft.assetId && !draft.persisted && draft.assetId !== result.id) {
          void mediaApi.cancel(draft.assetId).catch(() => undefined);
        }
        patchDraft(draft.clientId, {
          status: 'ready',
          progress: 100,
          assetId: result.id,
          aspectRatio: result.aspectRatio,
          presentation: {
            id: result.id,
            access: 'RESTRICTED',
            aspectRatio: result.aspectRatio,
            width: result.width,
            height: result.height
          },
          replacesClientId: undefined,
          replacedDraft: undefined
        });
        completePendingReplacement(draft);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!mediaUploadRegistry.isActive(draft.clientId, controller)) return;
        patchDraft(draft.clientId, {
          status: 'error',
          assetId: error instanceof MediaUploadError ? error.assetId : undefined,
          error: error instanceof Error ? error.message : t('media.uploadFailed', { defaultValue: 'Image upload failed.' })
        });
      } finally {
        mediaUploadRegistry.finish(draft.clientId, controller);
      }
    });
  };

  const addFiles = async (files: File[]): Promise<void> => {
    setValidationError(null);
    const replacementTarget = replacementTargetId
      ? valuesRef.current.find((draft) => draft.clientId === replacementTargetId)
      : undefined;
    const capacity = replacementTarget
      ? (multiple ? Math.max(1, maxFiles - valuesRef.current.length + 1) : 1)
      : multiple ? Math.max(0, maxFiles - valuesRef.current.length) : 1;
    if (files.length > capacity) {
      setValidationError(t('media.tooMany', { max: maxFiles, defaultValue: `You can add up to ${maxFiles} images.` }));
    }
    const accepted = files.slice(0, capacity).filter((file) => {
      if (!ALLOWED_TYPES.has(file.type)) {
        setValidationError(t('media.invalidType', { defaultValue: 'Use a JPEG, PNG, or WebP image.' }));
        return false;
      }
      const maxInputBytes = purpose === 'PROFILE_COVER' ? COVER_MAX_INPUT_BYTES : DEFAULT_MAX_INPUT_BYTES;
      if (file.size > maxInputBytes) {
        setValidationError(t(
          purpose === 'PROFILE_COVER' ? 'profile.cover.tooLarge' : 'media.tooLarge',
          { max: purpose === 'PROFILE_COVER' ? 10 : 15, defaultValue: `Images must be ${purpose === 'PROFILE_COVER' ? 10 : 15} MB or smaller.` }
        ));
        return false;
      }
      return true;
    });

    const drafts: MediaDraft[] = [];
    let establishedPostRatio = aspectRatio || valuesRef.current[0]?.aspectRatio;
    for (const file of accepted) {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      try {
        const sourceRatio = await loadImageRatio(previewUrl);
        if (purpose === 'POST' && !establishedPostRatio) {
          establishedPostRatio = Math.min(1.91, Math.max(0.8, sourceRatio));
        }
        const fixedRatio = fixedRatioForPurpose(purpose);
        const established = fixedRatio
          ? fixedRatio
          : purpose === 'POST'
            ? establishedPostRatio!
            : Math.min(1.91, Math.max(0.8, sourceRatio));
        drafts.push({
          clientId: crypto.randomUUID(),
          file,
          previewUrl,
          purpose,
          status: 'editing',
          progress: 0,
          aspectRatio: established
        });
      } catch {
        URL.revokeObjectURL(previewUrl);
        previewUrls.current.delete(previewUrl);
        setValidationError(t('media.invalidImage', { defaultValue: 'This image could not be opened.' }));
      }
    }
    if (drafts.length === 0) return;
    if (purpose === 'POST' && valuesRef.current.length === 0) onAspectRatioChange?.(drafts[0].aspectRatio);
    if (replacementTarget) {
      const [replacement, ...additionalDrafts] = drafts;
      replacement.replacesClientId = replacementTarget.clientId;
      replacement.replacedDraft = replacementTarget;
      pendingReplacements.current.set(replacement.clientId, replacementTarget);
      publish([
        ...valuesRef.current.map((draft) => draft.clientId === replacementTarget.clientId ? replacement : draft),
        ...additionalDrafts
      ]);
      setReplacementTargetId(null);
      setActiveEditorId(replacement.clientId);
    } else if (multiple) {
      publish([...valuesRef.current, ...drafts]);
    } else {
      if (!replacedPersistedDrafts.current) {
        const persisted = valuesRef.current.filter((draft) => draft.persisted);
        replacedPersistedDrafts.current = persisted.length > 0 ? persisted : null;
      }
      valuesRef.current.filter((draft) => !draft.persisted).forEach(releaseTransientDraft);
      publish([drafts[0]]);
    }
    setActiveEditorId(drafts[0].clientId);
  };

  const removeDraft = (draft: MediaDraft, restoreReplacement = false): void => {
    if (!draft.persisted) releaseTransientDraft(draft);
    const pendingReplacement = pendingReplacements.current.get(draft.clientId) || draft.replacedDraft;
    if (pendingReplacement) {
      pendingReplacements.current.delete(draft.clientId);
      publish(valuesRef.current.map((item) => item.clientId === draft.clientId
        ? { ...pendingReplacement, replacesClientId: draft.clientId, replacedDraft: undefined }
        : item));
      if (activeEditorId === draft.clientId) continueEditing(draft.clientId);
      return;
    }
    const replacement = !multiple && restoreReplacement ? replacedPersistedDrafts.current : null;
    publish(replacement || valuesRef.current.filter((item) => item.clientId !== draft.clientId));
    if (!replacement || restoreReplacement) replacedPersistedDrafts.current = null;
    if (activeEditorId === draft.clientId) continueEditing(draft.clientId);
  };

  const retry = (draft: MediaDraft): void => {
    if (!draft.crop) {
      setActiveEditorId(draft.clientId);
      return;
    }
    if (draft.assetId) {
      const controller = mediaUploadRegistry.create(draft.clientId);
      patchDraft(draft.clientId, { status: 'processing', error: undefined });
      void mediaUploadScheduler.schedule(async () => {
        try {
          const result = await mediaApi.retryFinalize(draft.assetId!, draft.crop!);
          if (!mediaUploadRegistry.isActive(draft.clientId, controller)) return;
          patchDraft(draft.clientId, {
            status: 'ready',
            progress: 100,
            aspectRatio: result.aspectRatio,
            presentation: { id: result.id, access: 'RESTRICTED', aspectRatio: result.aspectRatio, width: result.width, height: result.height },
            replacesClientId: undefined,
            replacedDraft: undefined
          });
          completePendingReplacement(draft);
        } catch (error) {
          if (!mediaUploadRegistry.isActive(draft.clientId, controller)) return;
          patchDraft(draft.clientId, { status: 'error', error: error instanceof Error ? error.message : t('media.processingFailed', { defaultValue: 'Image processing failed.' }) });
        } finally {
          mediaUploadRegistry.finish(draft.clientId, controller);
        }
      });
      return;
    }
    startUpload(draft, draft.crop);
  };

  const activeDraft = useMemo(() => value.find((draft) => draft.clientId === activeEditorId), [value, activeEditorId]);
  const canAdd = !disabled && value.length < maxFiles;
  const canSelect = !disabled && (multiple ? value.length < maxFiles : true);
  const controls: MediaPickerControls = {
    open: () => {
      setReplacementTargetId(null);
      inputRef.current?.click();
    },
    edit: (clientId) => setActiveEditorId(clientId),
    replace: (clientId) => {
      if (disabled) return;
      setReplacementTargetId(clientId);
      inputRef.current?.click();
    },
    retry: (clientId) => {
      const draft = valuesRef.current.find((item) => item.clientId === clientId);
      if (draft) retry(draft);
    },
    remove: (clientId) => {
      const draft = valuesRef.current.find((item) => item.clientId === clientId);
      if (draft) removeDraft(draft, Boolean(!draft.persisted && replacedPersistedDrafts.current));
    },
    isBusy: (clientId) => {
      const draft = valuesRef.current.find((item) => item.clientId === clientId);
      return Boolean(draft && ['editing', 'queued', 'uploading', 'processing'].includes(draft.status));
    },
    canSelect,
    busy: value.some((draft) => ['editing', 'queued', 'uploading', 'processing'].includes(draft.status))
  };

  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return;
    const oldIndex = valuesRef.current.findIndex((draft) => draft.clientId === active.id);
    const newIndex = valuesRef.current.findIndex((draft) => draft.clientId === over.id);
    publish(arrayMove(valuesRef.current, oldIndex, newIndex));
  };

  return (
    <div className={className}>
      {renderContent ? renderContent(controls) : (value.length > 0 || (showAddButton && canAdd)) ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={value.map((draft) => draft.clientId)} strategy={horizontalListSortingStrategy}>
            <div className="flex min-h-28 gap-2 overflow-x-auto pb-1">
              {value.map((draft, index) => (
                <SortableTile
                  key={draft.clientId}
                  draft={draft}
                  index={index}
                  sortable={multiple && value.length > 1}
                  onEdit={() => setActiveEditorId(draft.clientId)}
                  onRetry={() => retry(draft)}
                  onRemove={() => removeDraft(draft)}
                />
              ))}
              {showAddButton && canAdd && (
                <button type="button" onClick={() => inputRef.current?.click()} className="flex h-28 w-28 shrink-0 items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 text-gray-500 hover:border-blue-400 hover:text-blue-600" aria-label={t('media.add', { defaultValue: 'Add image' })} title={t('media.add', { defaultValue: 'Add image' })}>
                  <ImagePlus size={24} />
                </button>
              )}
            </div>
          </SortableContext>
        </DndContext>
      ) : null}

      {validationError && <p role="alert" className="mt-1 text-xs text-red-600">{validationError}</p>}
      {value.some((draft) => draft.status === 'error' && draft.error) && (
        <div className="mt-1 flex items-start gap-1 text-xs text-red-600" role="alert">
          <X size={14} className="mt-px shrink-0" />
          <span>{value.find((draft) => draft.status === 'error' && draft.error)?.error}</span>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/webp"
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          void addFiles(Array.from(event.target.files || []));
          event.target.value = '';
        }}
      />

      {activeDraft?.file && (
        <MediaCropEditor
          key={activeDraft.clientId}
          imageSrc={activeDraft.previewUrl}
          purpose={purpose}
          initialAspectRatio={activeDraft.aspectRatio}
          lockedAspectRatio={purpose === 'POST' && (activeDraft.clientId !== value[0]?.clientId || activeDraft.status !== 'editing') ? aspectRatio : undefined}
          initialCrop={activeDraft.crop}
          onCancel={() => {
            if (activeDraft.status === 'editing' && !activeDraft.crop) removeDraft(activeDraft, true);
            else setActiveEditorId(null);
          }}
          onApply={(crop) => {
            if (purpose === 'POST' && value[0]?.clientId === activeDraft.clientId) {
              publish(valuesRef.current.map((draft) => draft.clientId === activeDraft.clientId
                ? { ...draft, crop, aspectRatio: crop.aspectRatio }
                : draft.status === 'editing'
                  ? { ...draft, aspectRatio: crop.aspectRatio }
                  : draft));
              onAspectRatioChange?.(crop.aspectRatio);
            } else {
              patchDraft(activeDraft.clientId, { crop, aspectRatio: crop.aspectRatio });
            }
            startUpload({ ...activeDraft, crop, aspectRatio: crop.aspectRatio }, crop);
            continueEditing(activeDraft.clientId);
          }}
        />
      )}
    </div>
  );
});

MediaPicker.displayName = 'MediaPicker';
