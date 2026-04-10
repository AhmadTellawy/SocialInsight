import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

/**
 * Processes a base64 image string, compresses it, saves it to disk, and returns the URL.
 * If the input is not a base64 string (e.g. already a URL or empty), it returns the input as is.
 */
export const processBase64Image = async (base64String: string | null | undefined): Promise<string | null> => {
    if (!base64String) return null;

    // Fast check to see if it's a data url
    if (!base64String.startsWith('data:image/')) {
        return base64String;
    }

    try {
        // Extract base64 part
        const matches = base64String.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        
        if (!matches || matches.length !== 3) {
            console.error('Invalid base64 image stringformat');
            return base64String;
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
        console.error('Error processing base64 image:', error);
        return null;
    }
};
