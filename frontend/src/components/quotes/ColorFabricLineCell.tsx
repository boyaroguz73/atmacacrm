'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

type VariantRow = {
  id: string;
  name: string;
};

/** Ürün varyant adlarından hızlı seçim + serbest metin (renk/kumaş). */
export function ColorFabricLineCell({
  productId,
  value,
  onChange,
}: {
  productId?: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [variantNames, setVariantNames] = useState<string[]>([]);

  useEffect(() => {
    if (!productId) {
      setVariantNames([]);
      return;
    }
    let cancelled = false;
    api
      .get(`/products/${productId}/variants`)
      .then(({ data }) => {
        const rows = (Array.isArray(data) ? data : []) as VariantRow[];
        const names: string[] = [];
        for (const v of rows) {
          const n = typeof v.name === 'string' ? v.name.trim() : '';
          if (n) names.push(n);
        }
        const uniq = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'tr'));
        if (!cancelled) setVariantNames(uniq);
      })
      .catch(() => {
        if (!cancelled) setVariantNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const nameSelect = variantNames.length > 1;
  const selectValue = value && variantNames.includes(value) ? value : '';

  return (
    <div className="space-y-1">
      {nameSelect ? (
        <select
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v || value);
          }}
          className="w-full px-2 py-1 border border-gray-200 rounded-lg text-[11px] font-medium bg-white focus:outline-none focus:border-whatsapp"
        >
          <option value="">Varyant / renk ipucu…</option>
          {variantNames.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : null}
      <input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Renk, kumaş (serbest)"
        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
      />
    </div>
  );
}
