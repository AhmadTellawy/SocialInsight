import type { MediaPurpose } from '@prisma/client';
import { MEDIA_CONFIG, maxInputBytesForPurpose } from '../config/media';
import { MediaValidationError, processMediaBuffer } from '../services/mediaProcessor';

const LEGACY_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * Processes a base64 image string, compresses it, saves it to disk, and returns the URL.
 * Existing remote values are accepted only when they exactly match the stored compatibility value.
 */
export const processBase64Image = async (
    base64String: string | null | undefined,
    existingValue?: string | null,
    purpose: MediaPurpose = 'POST'
): Promise<string | null> => {
    if (!base64String) return null;

    if (!base64String.startsWith('data:')) {
        if (existingValue && base64String === existingValue) return existingValue;
        throw new MediaValidationError('REMOTE_MEDIA_NOT_ALLOWED', 'Remote image URLs are not accepted. Upload the image through the media service.');
    }

    try {
        const matches = LEGACY_DATA_URL.exec(base64String);
        if (!matches || matches[2].length % 4 !== 0) {
            throw new MediaValidationError('INVALID_IMAGE', 'The legacy image data is invalid.');
        }

        const maxInputBytes = maxInputBytesForPurpose(purpose);
        const maxEncodedLength = Math.ceil(maxInputBytes / 3) * 4;
        if (matches[2].length > maxEncodedLength) {
            throw new MediaValidationError('INVALID_FILE_SIZE', `Image must be no larger than ${Math.floor(maxInputBytes / 1024 / 1024)} MB.`);
        }

        const imageBuffer = Buffer.from(matches[2], 'base64');
        if (imageBuffer.toString('base64') !== matches[2]) {
            throw new MediaValidationError('INVALID_IMAGE', 'The legacy image data is invalid.');
        }

        const processed = await processMediaBuffer(imageBuffer, purpose, matches[1], {});
        if (
            processed.master.buffer.length > MEDIA_CONFIG.maxPreparedOutputBytes
            || processed.variants.some((variant) => variant.buffer.length > MEDIA_CONFIG.maxPreparedOutputBytes)
        ) {
            throw new MediaValidationError('IMAGE_OUTPUT_TOO_LARGE', 'The processed image is too large.');
        }

        return `data:image/webp;base64,${processed.master.buffer.toString('base64')}`;
        
    } catch (error) {
        if (error instanceof MediaValidationError) throw error;
        console.error(JSON.stringify({ event: 'legacy_image_processing_failed', code: 'INVALID_IMAGE' }));
        throw new MediaValidationError('INVALID_IMAGE', 'The legacy image could not be processed.');
    }
};
