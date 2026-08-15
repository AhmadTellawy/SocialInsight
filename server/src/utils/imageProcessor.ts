import sharp from 'sharp';
import { MediaValidationError } from '../services/mediaProcessor';

/**
 * Processes a base64 image string, compresses it, saves it to disk, and returns the URL.
 * Existing remote values are accepted only when they exactly match the stored compatibility value.
 */
export const processBase64Image = async (
    base64String: string | null | undefined,
    existingValue?: string | null
): Promise<string | null> => {
    if (!base64String) return null;

    if (!base64String.startsWith('data:image/')) {
        if (existingValue && base64String === existingValue) return existingValue;
        throw new MediaValidationError('REMOTE_MEDIA_NOT_ALLOWED', 'Remote image URLs are not accepted. Upload the image through the media service.');
    }

    try {
        // Extract base64 part
        const matches = base64String.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        
        if (!matches || matches.length !== 3) {
            throw new MediaValidationError('INVALID_IMAGE', 'The legacy image data is invalid.');
        }

        const imageBuffer = Buffer.from(matches[2], 'base64');

        // Compress and parse to webp using sharp and return as Data URL buffer
        const webpBuffer = await sharp(imageBuffer)
            .resize({ width: 1200, withoutEnlargement: true }) // Max width 1200px
            .webp({ quality: 80 }) 
            .toBuffer();

        // Return Data URL string to support Vercel serverless (No local FS requirements)
        return `data:image/webp;base64,${webpBuffer.toString('base64')}`;
        
    } catch (error) {
        if (error instanceof MediaValidationError) throw error;
        console.error('Error processing base64 image:', error);
        throw new MediaValidationError('INVALID_IMAGE', 'The legacy image could not be processed.');
    }
};
