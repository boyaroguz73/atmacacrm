'use client';

import { useEffect, useState } from 'react';

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

/** Statik dosya (avatar) için HTTP kökü — WS adresi img src'de kullanılamaz */
function backendOrigin(): string {
  const api = process.env.NEXT_PUBLIC_API_URL;
  if (api) {
    const base = api.replace(/\/api\/?$/, '').trim();
    if (base) return base;
  }
  const ws = process.env.NEXT_PUBLIC_WS_URL || '';
  if (ws.startsWith('wss://')) return `https://${ws.slice(6)}`;
  if (ws.startsWith('ws://')) return `http://${ws.slice(5)}`;
  if (ws.startsWith('http')) return ws.replace(/\/api\/?$/, '');
  return 'http://localhost:4000';
}

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
      ? avatarUrl
      : `${backendOrigin()}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`
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
