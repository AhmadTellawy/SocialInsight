import React from 'react';
import { User } from 'lucide-react';
import { MediaPresentation } from '../types';
import { MediaImage } from './media/MediaImage';

interface UserAvatarProps {
    src?: string | null;
    mediaId?: string | null;
    media?: MediaPresentation | null;
    alt?: string;
    size?: number;
    className?: string;
    name?: string; // New prop for beautiful initials fallback
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
    src,
    mediaId,
    media,
    alt = 'User',
    size = 40,
    className = '',
    name
}) => {
    const usableSrc = src && !/(?:ui-avatars\.com|api\.dicebear\.com|picsum\.photos|randomuser\.me)/i.test(src) ? src : null;
    const initials = (name || alt || '')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0))
        .join('')
        .toUpperCase();

    const fallback = (
        <span
            role="img"
            aria-label={alt}
            className={`rounded-full bg-gray-100 text-gray-500 flex shrink-0 items-center justify-center font-bold ${className}`}
            style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.34)) }}
        >
            {initials || <User size={Math.max(14, Math.round(size * 0.5))} aria-hidden="true" />}
        </span>
    );

    if (media || mediaId || usableSrc) {
        return (
            <MediaImage
                media={media}
                mediaId={mediaId}
                fallbackSrc={usableSrc}
                fallback={fallback}
                alt={alt}
                sizes={`${size}px`}
                className={`rounded-full object-cover ${className}`}
                style={{ width: size, height: size }}
            />
        );
    }

    return fallback;
};
