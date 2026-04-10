import React, { useState } from 'react';
import { User } from 'lucide-react';

interface UserAvatarProps {
    src?: string | null;
    alt?: string;
    size?: number;
    className?: string;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
    src,
    alt = 'User',
    size = 40,
    className = ''
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

    // Default avatar icon
    return (
        <div
            className={`rounded-full bg-gray-100 flex items-center justify-center ${className}`}
            style={{ width: size, height: size }}
        >
            <User size={size * 0.6} className="text-gray-400" strokeWidth={2} />
        </div>
    );
};
