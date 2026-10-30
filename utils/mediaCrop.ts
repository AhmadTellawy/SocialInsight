import type { MediaCropSelection } from '../types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Coordinates always refer to the untouched, orientation-corrected source. */
export function cropFromOriginal(sourceRatio: number, targetRatio: number, previous?: MediaCropSelection): MediaCropSelection {
  if (!Number.isFinite(sourceRatio) || sourceRatio <= 0 || !Number.isFinite(targetRatio) || targetRatio <= 0) {
    throw new Error('Invalid image dimensions');
  }
  const width = Math.min(1, targetRatio / sourceRatio);
  const height = Math.min(1, sourceRatio / targetRatio);
  const focalX = clamp(previous?.focalX ?? 0.5, 0, 1);
  const focalY = clamp(previous?.focalY ?? 0.5, 0, 1);
  return {
    aspectRatio: targetRatio, focalX, focalY, altText: previous?.altText,
    crop: { x: clamp(focalX - width / 2, 0, 1 - width), y: clamp(focalY - height / 2, 0, 1 - height), width, height }
  };
}

export function moveSourceCrop(selection: MediaCropSelection, dx: number, dy: number): MediaCropSelection {
  const { crop } = selection;
  const x = clamp(crop.x + dx, 0, 1 - crop.width);
  const y = clamp(crop.y + dy, 0, 1 - crop.height);
  return { ...selection, crop: { ...crop, x, y }, focalX: x + crop.width / 2, focalY: y + crop.height / 2 };
}
