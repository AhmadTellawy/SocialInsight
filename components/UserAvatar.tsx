import React, { useState } from 'react';
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

    // Professional initials fallback via ui-avatars
    const fallbackSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(name || alt || 'User')}&background=f3f4f6&color=9ca3af&size=200`;

    return (
        <img
            src={fallbackSrc}
            alt={alt}
            className={`rounded-full object-cover ${className}`}
            style={{ width: size, height: size }}
        />
    );
};
