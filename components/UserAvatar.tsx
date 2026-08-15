import React, { useEffect, useState } from 'react';
import { User } from 'lucide-react';

interface UserAvatarProps {
    src?: string | null;
    alt?: string;
    size?: number;
    className?: string;
    name?: string; // New prop for beautiful initials fallback
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
    src,
    alt = 'User',
    size = 40,
    className = '',
    name
}) => {
    const [imgError, setImgError] = useState(false);
    const initials = (name || alt || '')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0))
        .join('')
        .toUpperCase();

    useEffect(() => {
        setImgError(false);
    }, [src]);

    if (src && !imgError) {
        return (
            <img
                src={src}
                alt={alt}
                onError={() => setImgError(true)}
                className={`rounded-full object-cover ${className}`}
                style={{ width: size, height: size }}
            />
        );
    }

    return (
        <span
            role="img"
            aria-label={alt}
            className={`rounded-full bg-gray-100 text-gray-500 flex shrink-0 items-center justify-center font-bold ${className}`}
            style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.34)) }}
        >
            {initials || <User size={Math.max(14, Math.round(size * 0.5))} aria-hidden="true" />}
        </span>
    );
};
