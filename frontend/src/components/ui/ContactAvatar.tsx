'use client';

import { useEffect, useState } from 'react';
import { backendPublicUrl, rewriteMediaUrlForClient } from '@/lib/utils';

interface ContactAvatarProps {
  name?: string | null;
  surname?: string | null;
  phone?: string;
  avatarUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses: Record<string, { container: string; text: string; img: string }> = {
  xs: { container: 'w-7 h-7', text: 'text-[10px]', img: 'w-7 h-7' },
  sm: { container: 'w-9 h-9', text: 'text-sm', img: 'w-9 h-9' },
  md: { container: 'w-11 h-11', text: 'text-base', img: 'w-11 h-11' },
  lg: { container: 'w-14 h-14', text: 'text-xl', img: 'w-14 h-14' },
  xl: { container: 'w-20 h-20', text: 'text-3xl', img: 'w-20 h-20' },
};

export default function ContactAvatar({
  name,
  surname,
  phone,
  avatarUrl,
  size = 'sm',
}: ContactAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const s = sizeClasses[size];

  const initial = (name || surname || phone || '?').charAt(0).toUpperCase();

  const fullUrl = avatarUrl
    ? avatarUrl.startsWith('http')
      ? rewriteMediaUrlForClient(avatarUrl)
      : `${backendPublicUrl()}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`
    : null;

  useEffect(() => {
    setImgError(false);
  }, [fullUrl]);

  if (fullUrl && !imgError) {
    return (
      <img
        key={fullUrl}
        src={fullUrl}
        alt={name || phone || ''}
        className={`${s.img} rounded-full object-cover flex-shrink-0`}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={`${s.container} bg-whatsapp/10 rounded-full flex items-center justify-center flex-shrink-0`}
    >
      <span className={`text-whatsapp font-bold ${s.text}`}>{initial}</span>
    </div>
  );
}
