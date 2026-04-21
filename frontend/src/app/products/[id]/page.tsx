'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
import { rewriteMediaUrlForClient } from '@/lib/utils';
import {
  ArrowLeft,
  Loader2,
  Package,
  RefreshCw,
  Save,
} from 'lucide-react';

type ProductDetail = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  unitPrice: number;
  currency: string;
  vatRate: number;
  priceIncludesVat: boolean;
  stock: number | null;
  isActive: boolean;
  productFeedSource?: 'MANUAL' | 'TSOFT';
  productUrl?: string | null;
  imageUrl?: string | null;
  category?: string | null;
  listPrice?: number | null;
  salePriceAmount?: number | null;
  salePriceEffectiveRange?: string | null;
  brand?: string | null;
  googleProductCategory?: string | null;
  googleProductType?: string | null;
  googleCustomLabel0?: string | null;
  googleCondition?: string | null;
  googleAvailability?: string | null;
  googleIdentifierExists?: string | null;
  gtin?: string | null;
  additionalImages?: unknown;
  tsoftId?: string | null;
  tsoftLastPulledAt?: string | null;
  pendingPushOp?: string | null;
};

type VariantRow = {
  id: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  unitPrice: number;
  listPrice?: number | null;
  salePriceAmount?: number | null;
  currency?: string;
  vatRate?: number;
  priceIncludesVat?: boolean;
  stock?: number | null;
  isActive?: boolean;
  imageUrl?: string | null;
  tsoftId?: string | null;
};

function parseAdditionalImagesJson(raw: unknown): string {
  if (raw == null) return '';
  if (Array.isArray(raw)) {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return '';
    }
  }
  if (typeof raw === 'string') return raw;
  return String(raw);
}

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [pushToTsoft, setPushToTsoft] = useState(false);

  const [form, setForm] = useState({
    sku: '',
    name: '',
    description: '',
    unit: 'Adet',
    unitPrice: '',
    currency: 'TRY',
    vatRate: '20',
    priceIncludesVat: true,
    stock: '',
    isActive: true,
    category: '',
    brand: '',
    productUrl: '',
    imageUrl: '',
    listPrice: '',
    salePriceAmount: '',
    salePriceEffectiveRange: '',
    googleProductCategory: '',
    googleProductType: '',
    googleCustomLabel0: '',
    googleCondition: '',
    googleAvailability: '',
    googleIdentifierExists: '',
    gtin: '',
    additionalImagesJson: '',
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get<ProductDetail>(`/products/${id}`);
      setProduct(data);
      setPushToTsoft(data.productFeedSource === 'TSOFT');
      setForm({
        sku: data.sku,
        name: data.name,
        description: data.description ?? '',
        unit: data.unit || 'Adet',
        unitPrice: String(data.unitPrice),
        currency: data.currency || 'TRY',
        vatRate: String(data.vatRate),
        priceIncludesVat: data.priceIncludesVat !== false,
        stock: data.stock != null ? String(data.stock) : '',
        isActive: data.isActive,
        category: data.category ?? '',
        brand: data.brand ?? '',
        productUrl: data.productUrl ?? '',
        imageUrl: data.imageUrl ?? '',
        listPrice: data.listPrice != null ? String(data.listPrice) : '',
        salePriceAmount: data.salePriceAmount != null ? String(data.salePriceAmount) : '',
        salePriceEffectiveRange: data.salePriceEffectiveRange ?? '',
        googleProductCategory: data.googleProductCategory ?? '',
        googleProductType: data.googleProductType ?? '',
        googleCustomLabel0: data.googleCustomLabel0 ?? '',
        googleCondition: data.googleCondition ?? '',
        googleAvailability: data.googleAvailability ?? '',
        googleIdentifierExists: data.googleIdentifierExists ?? '',
        gtin: data.gtin ?? '',
        additionalImagesJson: parseAdditionalImagesJson(data.additionalImages),
      });
      const { data: vdata } = await api.get<VariantRow[]>(`/products/${id}/variants`);
      setVariants(Array.isArray(vdata) ? vdata.filter((x) => x?.id) : []);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Ürün yüklenemedi'));
      setProduct(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !product) return;
    const unitPrice = parseFloat(form.unitPrice.replace(',', '.'));
    if (!form.sku.trim() || !form.name.trim()) {
      toast.error('SKU ve ad zorunludur');
      return;
    }
    if (Number.isNaN(unitPrice) || unitPrice < 0) {
      toast.error('Geçerli bir birim fiyat girin');
      return;
    }
    let additionalImages: string[] | undefined;
    const aj = form.additionalImagesJson.trim();
    if (aj) {
      try {
        const parsed = JSON.parse(aj) as unknown;
        if (!Array.isArray(parsed)) throw new Error('dizi değil');
        additionalImages = parsed.map((x) => String(x));
      } catch {
        toast.error('Ek görseller geçerli bir JSON dizi olmalı (örn. ["https://..."])');
        return;
      }
    }

    const stockVal = form.stock.trim() === '' ? null : parseInt(form.stock, 10);
    if (form.stock.trim() !== '' && Number.isNaN(stockVal as number)) {
      toast.error('Stok sayı olmalıdır');
      return;
    }

    const payload: Record<string, unknown> = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      unit: form.unit.trim() || 'Adet',
      unitPrice,
      currency: form.currency,
      vatRate: parseInt(form.vatRate, 10),
      priceIncludesVat: form.priceIncludesVat,
      stock: stockVal,
      isActive: form.isActive,
      category: form.category.trim() || null,
      brand: form.brand.trim() || null,
      productUrl: form.productUrl.trim() || null,
      imageUrl: form.imageUrl.trim() || null,
      listPrice: form.listPrice.trim() === '' ? null : parseFloat(form.listPrice.replace(',', '.')),
      salePriceAmount:
        form.salePriceAmount.trim() === '' ? null : parseFloat(form.salePriceAmount.replace(',', '.')),
      salePriceEffectiveRange: form.salePriceEffectiveRange.trim() || null,
      googleProductCategory: form.googleProductCategory.trim() || null,
      googleProductType: form.googleProductType.trim() || null,
      googleCustomLabel0: form.googleCustomLabel0.trim() || null,
      googleCondition: form.googleCondition.trim() || null,
      googleAvailability: form.googleAvailability.trim() || null,
      googleIdentifierExists: form.googleIdentifierExists.trim() || null,
      gtin: form.gtin.trim() || null,
      additionalImages: additionalImages ?? null,
    };
    if (pushToTsoft && product.productFeedSource === 'TSOFT') payload.pushToTsoft = true;

    setSaving(true);
    try {
      const { data } = await api.patch<ProductDetail>(`/products/${id}`, payload);
      setProduct(data);
      toast.success(pushToTsoft && data.productFeedSource === 'TSOFT' ? 'Kaydedildi · T-Soft kuyruğa alındı' : 'Kaydedildi');
      void load();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Kayıt başarısız'));
    } finally {
      setSaving(false);
    }
  };

  const saveVariant = async (v: VariantRow, draft: VariantRow) => {
    if (!isAdmin) return;
    setSaving(true);
    try {
      await api.patch(`/products/${id}/variants/${v.id}`, {
        name: draft.name,
        sku: draft.sku || null,
        description: draft.description || null,
        unitPrice: draft.unitPrice,
        listPrice: draft.listPrice ?? null,
        salePriceAmount: draft.salePriceAmount ?? null,
        currency: draft.currency || form.currency,
        vatRate: draft.vatRate ?? parseInt(form.vatRate, 10),
        priceIncludesVat: draft.priceIncludesVat !== false,
        stock: draft.stock ?? null,
        isActive: draft.isActive !== false,
        imageUrl: draft.imageUrl || null,
      });
      toast.success('Varyant güncellendi');
      void load();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Varyant kaydedilemedi'));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !product) {
    return (
      <div className="p-6 flex items-center justify-center gap-2 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin text-whatsapp" />
        Yükleniyor…
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center space-y-4">
        <p className="text-gray-600">Ürün bulunamadı.</p>
        <Link href="/products" className="text-whatsapp font-medium hover:underline">
          Ürün listesine dön
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 pt-0 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/products')}
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Liste
        </button>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2 flex-1 min-w-[200px]">
          <Package className="w-7 h-7 text-whatsapp" />
          <span className="truncate">{product.name}</span>
        </h1>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          Yenile
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span
          className={`px-2 py-1 rounded-md font-semibold uppercase ${
            product.productFeedSource === 'TSOFT' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-700'
          }`}
        >
          {product.productFeedSource === 'TSOFT' ? 'T-Soft' : 'El ile'}
        </span>
        {product.tsoftId ? (
          <span className="px-2 py-1 rounded-md bg-gray-50 text-gray-700">T-Soft ID: {product.tsoftId}</span>
        ) : null}
        {product.pendingPushOp ? (
          <span className="px-2 py-1 rounded-md bg-amber-100 text-amber-900">Kuyruk: {product.pendingPushOp}</span>
        ) : null}
      </div>

      {product.imageUrl ? (
        <div className="w-32 h-32 rounded-xl border border-gray-100 overflow-hidden bg-gray-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={rewriteMediaUrlForClient(product.imageUrl)}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        </div>
      ) : null}

      <form onSubmit={saveProduct} className="space-y-8">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Temel</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">SKU</label>
              <input
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Ad</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Açıklama</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              disabled={!isAdmin}
              rows={4}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Kategori</label>
              <input
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Marka</label>
              <input
                value={form.brand}
                onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              disabled={!isAdmin}
              className="rounded border-gray-300"
            />
            Aktif
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.priceIncludesVat}
              onChange={(e) => setForm((f) => ({ ...f, priceIncludesVat: e.target.checked }))}
              disabled={!isAdmin}
              className="rounded border-gray-300"
            />
            Birim fiyat KDV dahil
          </label>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Fiyat ve stok</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Birim</label>
              <input
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Birim fiyat</label>
              <input
                value={form.unitPrice}
                onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Liste fiyatı</label>
              <input
                value={form.listPrice}
                onChange={(e) => setForm((f) => ({ ...f, listPrice: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">İndirimli fiyat</label>
              <input
                value={form.salePriceAmount}
                onChange={(e) => setForm((f) => ({ ...f, salePriceAmount: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">İndirim tarih aralığı (ham metin)</label>
              <input
                value={form.salePriceEffectiveRange}
                onChange={(e) => setForm((f) => ({ ...f, salePriceEffectiveRange: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Para birimi</label>
              <select
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white disabled:bg-gray-50"
              >
                <option value="TRY">TRY</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">KDV %</label>
              <select
                value={form.vatRate}
                onChange={(e) => setForm((f) => ({ ...f, vatRate: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white disabled:bg-gray-50"
              >
                <option value="0">0</option>
                <option value="1">1</option>
                <option value="10">10</option>
                <option value="20">20</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Stok</label>
              <input
                value={form.stock}
                onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">URL ve görseller</h2>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ürün URL</label>
            <input
              value={form.productUrl}
              onChange={(e) => setForm((f) => ({ ...f, productUrl: e.target.value }))}
              disabled={!isAdmin}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ana görsel URL</label>
            <input
              value={form.imageUrl}
              onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
              disabled={!isAdmin}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ek görseller (JSON dizi)</label>
            <textarea
              value={form.additionalImagesJson}
              onChange={(e) => setForm((f) => ({ ...f, additionalImagesJson: e.target.value }))}
              disabled={!isAdmin}
              rows={4}
              placeholder='["https://..."]'
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm font-mono disabled:bg-gray-50"
            />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Google / feed alanları</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">google_product_category</label>
              <input
                value={form.googleProductCategory}
                onChange={(e) => setForm((f) => ({ ...f, googleProductCategory: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">google_product_type</label>
              <input
                value={form.googleProductType}
                onChange={(e) => setForm((f) => ({ ...f, googleProductType: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">custom_label_0</label>
              <input
                value={form.googleCustomLabel0}
                onChange={(e) => setForm((f) => ({ ...f, googleCustomLabel0: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">condition</label>
              <input
                value={form.googleCondition}
                onChange={(e) => setForm((f) => ({ ...f, googleCondition: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">availability</label>
              <input
                value={form.googleAvailability}
                onChange={(e) => setForm((f) => ({ ...f, googleAvailability: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">identifier_exists</label>
              <input
                value={form.googleIdentifierExists}
                onChange={(e) => setForm((f) => ({ ...f, googleIdentifierExists: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">GTIN</label>
              <input
                value={form.gtin}
                onChange={(e) => setForm((f) => ({ ...f, gtin: e.target.value }))}
                disabled={!isAdmin}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50"
              />
            </div>
          </div>
        </div>

        {product.productFeedSource === 'TSOFT' && isAdmin ? (
          <label className="flex items-start gap-2 text-sm text-gray-700 bg-orange-50/80 border border-orange-200 rounded-xl p-4">
            <input
              type="checkbox"
              checked={pushToTsoft}
              onChange={(e) => setPushToTsoft(e.target.checked)}
              className="mt-1 rounded border-orange-300"
            />
            <span>
              <span className="font-medium text-orange-900">{"T-Soft'a da yaz (kuyruk)"}</span>
              <span className="block text-xs text-orange-800 mt-1">
                Kaydettiğinizde değişiklikler T-Soft kuyruğuna alınır.
              </span>
            </span>
          </label>
        ) : null}

        {isAdmin ? (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-medium hover:bg-whatsapp/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Ürünü kaydet
            </button>
          </div>
        ) : null}
      </form>

      {variants.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Varyantlar ({variants.length})</h2>
          <div className="space-y-6">
            {variants.map((v) => (
              <VariantEditor key={v.id} v={v} currency={form.currency} isAdmin={isAdmin} onSave={saveVariant} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VariantEditor({
  v,
  currency,
  isAdmin,
  onSave,
}: {
  v: VariantRow;
  currency: string;
  isAdmin: boolean;
  onSave: (v: VariantRow, draft: VariantRow) => void;
}) {
  const [draft, setDraft] = useState<VariantRow>({ ...v });
  useEffect(() => {
    setDraft({ ...v });
  }, [v]);

  return (
    <div className="border border-gray-100 rounded-lg p-4 space-y-3 bg-gray-50/50">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] font-medium text-gray-500">Ad</label>
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            disabled={!isAdmin}
            className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-gray-200 text-sm disabled:bg-gray-100"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium text-gray-500">SKU</label>
          <input
            value={draft.sku ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, sku: e.target.value }))}
            disabled={!isAdmin}
            className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-gray-200 text-sm font-mono disabled:bg-gray-100"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium text-gray-500">Normal fiyat ({currency})</label>
          <input
            type="number"
            step="0.01"
            value={draft.unitPrice}
            onChange={(e) => setDraft((d) => ({ ...d, unitPrice: parseFloat(e.target.value) || 0 }))}
            disabled={!isAdmin}
            className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-gray-200 text-sm disabled:bg-gray-100"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium text-gray-500">Liste fiyatı ({currency})</label>
          <input
            type="number"
            step="0.01"
            value={draft.listPrice ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                listPrice: e.target.value === '' ? null : parseFloat(e.target.value) || 0,
              }))
            }
            disabled={!isAdmin}
            placeholder="Boş bırakılabilir"
            className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-gray-200 text-sm disabled:bg-gray-100"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium text-gray-500">İndirimli fiyat ({currency})</label>
          <input
            type="number"
            step="0.01"
            value={draft.salePriceAmount ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                salePriceAmount: e.target.value === '' ? null : parseFloat(e.target.value) || 0,
              }))
            }
            disabled={!isAdmin}
            placeholder="Boş bırakılabilir"
            className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-gray-200 text-sm disabled:bg-gray-100"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium text-gray-500">Stok</label>
          <input
            type="number"
            value={draft.stock ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                stock: e.target.value === '' ? null : parseInt(e.target.value, 10),
              }))
            }
            disabled={!isAdmin}
            className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-gray-200 text-sm disabled:bg-gray-100"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={draft.isActive !== false}
              onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
              disabled={!isAdmin}
              className="rounded border-gray-300"
            />
            Aktif
          </label>
        </div>
      </div>
      {v.tsoftId ? <p className="text-[10px] text-gray-400">T-Soft varyant ID: {v.tsoftId}</p> : null}
      {isAdmin ? (
        <button
          type="button"
          onClick={() => onSave(v, draft)}
          className="text-xs font-medium text-whatsapp hover:underline"
        >
          Bu varyantı kaydet
        </button>
      ) : null}
    </div>
  );
}
