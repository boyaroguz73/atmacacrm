'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

/** XML varyant metadata.type2 değerlerinden ölçü seçimi + serbest metin. */
export function MeasurementLineCell({
  productId,
  value,
  onChange,
}: {
  productId?: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    if (!productId) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    api
      .get(`/products/${productId}/variants`)
      .then(({ data }) => {
        const rows = Array.isArray(data) ? data : [];
        const uniq = new Set<string>();
        for (const v of rows) {
          const m = v.metadata as Record<string, unknown> | undefined;
          const t2 = typeof m?.type2 === 'string' ? m.type2.trim() : '';
          if (t2) uniq.add(t2);
        }
        if (!cancelled) setOptions(Array.from(uniq).sort((a, b) => a.localeCompare(b, 'tr')));
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const showSelect = options.length > 0;
  const selectValue = value && options.includes(value) ? value : '';

  return (
    <div className="space-y-1">
      {showSelect ? (
        <select
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v || value);
          }}
          className="w-full px-2 py-1 border border-gray-200 rounded-lg text-[11px] font-medium bg-white focus:outline-none focus:border-whatsapp"
        >
          <option value="">XML ölçü seç…</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : null}
      <input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Örn. 180×200"
        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
      />
    </div>
  );
}
