'use client';

import { Package } from 'lucide-react';
import { rewriteMediaUrlForClient } from '@/lib/utils';

export function VariantPickerOption({
  name,
  priceDisplay,
  imageUrl,
  onSelect,
}: {
  name: string;
  priceDisplay: string;
  imageUrl?: string | null;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-100 hover:bg-green-50 text-sm text-left transition-colors"
    >
      <div className="w-14 h-14 shrink-0 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden flex items-center justify-center">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={rewriteMediaUrlForClient(imageUrl)} alt="" className="w-full h-full object-cover" />
        ) : (
          <Package className="w-7 h-7 text-gray-300" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-900 line-clamp-2">{name}</div>
        <div className="text-xs text-gray-500 tabular-nums mt-0.5">{priceDisplay}</div>
      </div>
    </button>
  );
}
