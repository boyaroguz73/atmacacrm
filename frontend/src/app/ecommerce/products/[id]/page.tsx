'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Loader2,
  Package,
  Save,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

type CatalogProduct = {
  id: string;
  tsoftProductId: string | null;
  productCode: string;
  barcode: string | null;
  productName: string;
  sellingPrice: number | null;
  listPrice: number | null;
  buyingPrice: number | null;
  currency: string;
  stock: number | null;
  vatRate: number | null;
  brand: string | null;
  model: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  isActive: boolean;
  shortDescription: string | null;
  detailsText: string | null;
  subproductsJson: unknown;
  rawSnapshotJson: unknown;
  syncedAt: string;
  updatedAt: string;
};

export default function EcommerceProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === 'string' ? params.id : '';

  const [p, setP] = useState<CatalogProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [showSubs, setShowSubs] = useState(false);

  const [form, setForm] = useState<Partial<CatalogProduct>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/ecommerce/tsoft/catalog/${id}`);
      setP(data);
      setForm(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Ürün yüklenemedi');
      setP(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!p) return;
    setSaving(true);
    try {
      await api.patch(`/ecommerce/tsoft/catalog/${p.id}`, {
        productName: form.productName,
        sellingPrice: form.sellingPrice ?? undefined,
        listPrice: form.listPrice === undefined ? undefined : form.listPrice,
        buyingPrice: form.buyingPrice === undefined ? undefined : form.buyingPrice,
        stock: form.stock === undefined ? undefined : form.stock,
        vatRate: form.vatRate === undefined ? undefined : form.vatRate,
        currency: form.currency,
        isActive: form.isActive,
        brand: form.brand === undefined ? undefined : form.brand,
        barcode: form.barcode === undefined ? undefined : form.barcode,
        model: form.model === undefined ? undefined : form.model,
        categoryCode: form.categoryCode === undefined ? undefined : form.categoryCode,
        categoryName: form.categoryName === undefined ? undefined : form.categoryName,
        shortDescription: form.shortDescription === undefined ? undefined : form.shortDescription,
        detailsText: form.detailsText === undefined ? undefined : form.detailsText,
        pushToSite: true,
      });
      toast.success('Kaydedildi');
      await load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      await api.post('/ecommerce/tsoft/sync-catalog', {}, { timeout: 300_000 });
      toast.success('Katalog T-Soft ile senkronlandı');
      await load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Senkron başarısız');
    } finally {
      setSyncing(false);
    }
  };

  const remove = async () => {
    if (!p) return;
    if (!window.confirm('Bu ürünü silmek istediğinize emin misiniz?')) return;
    const siteToo = window.confirm('Mağazadaki (T-Soft) ürünü de silinsin mi?\n\nTamam: mağaza + CRM\nİptal: yalnız CRM');
    try {
      await api.delete(`/ecommerce/tsoft/catalog/${p.id}`, { params: { deleteOnSite: siteToo ? 'true' : 'false' } });
      toast.success('Silindi');
      router.push('/ecommerce/products');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Silinemedi');
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex justify-center text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!p) {
    return (
      <div className="p-8 text-center text-gray-500">
        Ürün bulunamadı.{' '}
        <Link href="/ecommerce/products" className="text-orange-600 underline">
          Listeye dön
        </Link>
      </div>
    );
  }

  const subs = p.subproductsJson;
  const hasSubs = subs != null && typeof subs === 'object' && (Array.isArray(subs) ? subs.length > 0 : true);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 pb-24">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/ecommerce/products"
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Ürün listesi
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-8 h-8 text-orange-500" />
            {p.productName}
          </h1>
          <p className="text-sm text-gray-500 mt-1 font-mono">{p.productCode}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={runSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-orange-50 text-orange-800 hover:bg-orange-100 disabled:opacity-50"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            T-Soft’tan yenile
          </button>
          <button
            type="button"
            onClick={remove}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-800 hover:bg-red-100"
          >
            <Trash2 className="w-4 h-4" />
            Sil
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-semibold text-gray-500 uppercase mb-3">Durum</h2>
          <div className="space-y-2 text-sm">
            <Row label="Aktif" value={p.isActive ? 'Evet' : 'Hayır'} />
            <Row label="T-Soft ürün no" value={p.tsoftProductId || '—'} />
            <Row label="Son senkron" value={new Date(p.syncedAt).toLocaleString('tr-TR')} />
            <Row label="Kayıt güncelleme" value={new Date(p.updatedAt).toLocaleString('tr-TR')} />
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-semibold text-gray-500 uppercase mb-3">Fiyat ve stok</h2>
          <div className="space-y-2 text-sm">
            <Row label="Satış fiyatı" value={p.sellingPrice != null ? `${p.sellingPrice} ${p.currency}` : '—'} />
            <Row label="Liste fiyatı" value={p.listPrice != null ? `${p.listPrice}` : '—'} />
            <Row label="Alış fiyatı" value={p.buyingPrice != null ? `${p.buyingPrice}` : '—'} />
            <Row label="Stok" value={p.stock != null ? String(p.stock) : '—'} />
            <Row label="KDV %" value={p.vatRate != null ? String(p.vatRate) : '—'} />
            <Row label="Para birimi" value={p.currency} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Düzenle (T-Soft’a yazılır)</h2>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <Field label="Ürün adı" value={form.productName ?? ''} onChange={(v) => setForm((f) => ({ ...f, productName: v }))} />
          <Field label="Marka" value={form.brand ?? ''} onChange={(v) => setForm((f) => ({ ...f, brand: v || null }))} />
          <Field label="Model" value={form.model ?? ''} onChange={(v) => setForm((f) => ({ ...f, model: v || null }))} />
          <Field label="Barkod" value={form.barcode ?? ''} onChange={(v) => setForm((f) => ({ ...f, barcode: v || null }))} />
          <Num label="Satış fiyatı" value={form.sellingPrice} onChange={(n) => setForm((f) => ({ ...f, sellingPrice: n }))} />
          <Num label="Liste fiyatı" value={form.listPrice} onChange={(n) => setForm((f) => ({ ...f, listPrice: n }))} />
          <Num label="Alış fiyatı" value={form.buyingPrice} onChange={(n) => setForm((f) => ({ ...f, buyingPrice: n }))} />
          <Num label="Stok" value={form.stock} onChange={(n) => setForm((f) => ({ ...f, stock: n }))} int />
          <Num label="KDV %" value={form.vatRate} onChange={(n) => setForm((f) => ({ ...f, vatRate: n }))} int />
          <Field label="Para birimi" value={form.currency ?? ''} onChange={(v) => setForm((f) => ({ ...f, currency: v }))} />
          <Field label="Kategori kodu" value={form.categoryCode ?? ''} onChange={(v) => setForm((f) => ({ ...f, categoryCode: v || null }))} />
          <Field label="Kategori adı" value={form.categoryName ?? ''} onChange={(v) => setForm((f) => ({ ...f, categoryName: v || null }))} />
          <label className="flex items-center gap-2 sm:col-span-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            <span>Ürün aktif</span>
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-gray-600 text-xs">Kısa açıklama</span>
          <textarea
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 min-h-[72px]"
            value={form.shortDescription ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, shortDescription: e.target.value || null }))}
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600 text-xs">Detay metni</span>
          <textarea
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 min-h-[120px] font-mono text-xs"
            value={form.detailsText ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, detailsText: e.target.value || null }))}
          />
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Kaydet
        </button>
      </div>

      {hasSubs && (
        <div className="rounded-xl border border-gray-100 bg-gray-50/50 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowSubs(!showSubs)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-800"
          >
            Alt ürünler (varyantlar)
            {showSubs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showSubs && (
            <pre className="text-xs p-4 overflow-x-auto border-t border-gray-100 bg-white max-h-80">
              {JSON.stringify(subs, null, 2)}
            </pre>
          )}
        </div>
      )}

      <div className="rounded-xl border border-gray-100 bg-gray-50/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowRaw(!showRaw)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-800"
        >
          T-Soft ham veri (teknik)
          {showRaw ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showRaw && (
          <pre className="text-xs p-4 overflow-x-auto border-t border-gray-100 bg-white max-h-96">
            {p.rawSnapshotJson != null ? JSON.stringify(p.rawSnapshotJson, null, 2) : '—'}
          </pre>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 text-right break-all">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-600">{label}</span>
      <input
        className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Num({
  label,
  value,
  onChange,
  int,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (n: number | null) => void;
  int?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-600">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200"
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => {
          const t = e.target.value.trim();
          if (t === '') {
            onChange(null);
            return;
          }
          const n = int ? parseInt(t, 10) : parseFloat(t.replace(',', '.'));
          onChange(Number.isFinite(n) ? n : null);
        }}
      />
    </label>
  );
}
