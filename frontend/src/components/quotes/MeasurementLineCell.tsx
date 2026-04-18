'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

type VariantRow = {
  id: string;
  name: string;
  metadata?: unknown;
};

/** XML type2 + tüm aktif varyant adlarından ölçü seçimi; gerekirse serbest metin. */
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
  const [variantNames, setVariantNames] = useState<string[]>([]);

  useEffect(() => {
    if (!productId) {
      setOptions([]);
      setVariantNames([]);
      return;
    }
    let cancelled = false;
    api
      .get(`/products/${productId}/variants`)
      .then(({ data }) => {
        const rows = (Array.isArray(data) ? data : []) as VariantRow[];
        const uniqType2 = new Set<string>();
        const names: string[] = [];
        for (const v of rows) {
          const m = v.metadata as Record<string, unknown> | undefined;
          const t2 = typeof m?.type2 === 'string' ? m.type2.trim() : '';
          if (t2) uniqType2.add(t2);
          const n = typeof v.name === 'string' ? v.name.trim() : '';
          if (n) names.push(n);
        }
        const uniqNames = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'tr'));
        if (!cancelled) {
          setOptions(Array.from(uniqType2).sort((a, b) => a.localeCompare(b, 'tr')));
          setVariantNames(uniqNames);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOptions([]);
          setVariantNames([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const type2Select = options.length > 0;
  const nameSelect = !type2Select && variantNames.length > 1;
  const selectValue =
    value && (type2Select ? options : variantNames).includes(value) ? value : '';

  return (
    <div className="space-y-1">
      {type2Select ? (
        <select
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v || value);
          }}
          className="w-full px-2 py-1 border border-gray-200 rounded-lg text-[11px] font-medium bg-white focus:outline-none focus:border-whatsapp"
        >
          <option value="">Ölçü / varyant (XML type2)…</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : null}
      {nameSelect ? (
        <select
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v || value);
          }}
          className="w-full px-2 py-1 border border-gray-200 rounded-lg text-[11px] font-medium bg-white focus:outline-none focus:border-whatsapp"
        >
          <option value="">Ürün varyantı seç…</option>
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
        placeholder="Örn. 180×200"
        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
      />
    </div>
  );
}
