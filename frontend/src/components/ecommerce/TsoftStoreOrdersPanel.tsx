'use client';

import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Store } from 'lucide-react';

type SiteOrderRow = Record<string, unknown>;

type Props = {
  defaultOpen?: boolean;
  onCrmOrdersSynced?: () => void;
};

function formatTsoftDate(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'number' || (typeof v === 'string' && /^\d{10,}$/.test(v))) {
    const ts = Number(v);
    const d = new Date(ts < 1e12 ? ts * 1000 : ts);
    return d.toLocaleDateString('tr-TR');
  }
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('tr-TR') : String(v);
}

function summarize(r: unknown) {
  if (!r || typeof r !== 'object') {
    return { no: '—', customer: '', status: '', total: '', date: '', numericId: '' };
  }
  const o = r as Record<string, unknown>;
  return {
    no: String(o.OrderCode ?? o.OrderId ?? o.orderNumber ?? o.id ?? '—'),
    customer: String(o.CustomerName ?? o.customerName ?? ''),
    status: String(o.OrderStatus ?? o.orderStatus ?? o.status ?? ''),
    total: o.OrderTotalPrice != null ? String(o.OrderTotalPrice) : o.orderTotal != null ? String(o.orderTotal) : '',
    date: formatTsoftDate(o.OrderDate ?? o.OrderDateTimeStamp ?? o.createDate ?? o.createdAt),
    numericId: String(o.OrderId ?? o.orderId ?? ''),
  };
}

export default function TsoftStoreOrdersPanel({ defaultOpen = false, onCrmOrdersSynced }: Props) {
  const [panelOpen, setPanelOpen] = useState(defaultOpen);
  const [rows, setRows] = useState<SiteOrderRow[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setPanelOpen(defaultOpen);
  }, [defaultOpen]);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const { data } = await api.get('/ecommerce/tsoft/orders', { params: { page: p, limit: 50 } });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Mağaza siparişleri yüklenemedi');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page);
  }, [page, load]);

  const refreshAndSync = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-orders', {}, { timeout: 120_000 });
      const max = data?.maxPerSync != null ? ` (en fazla ${data.maxPerSync} sipariş)` : '';
      toast.success(
        `Siparişler CRM’e aktarıldı: ${data.imported} yeni, ${data.skippedExisting} zaten kayıtlı, ${data.errors || 0} hata${max}`,
      );
      await load(page);
      onCrmOrdersSynced?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Yenileme başarısız');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <details
      className="group rounded-xl border border-orange-100 bg-gradient-to-b from-orange-50/40 to-white shadow-sm overflow-hidden"
      open={panelOpen}
      onToggle={(e) => setPanelOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-orange-100/80 bg-orange-50/50">
        <div className="flex items-center gap-2 min-w-0">
          <Store className="w-5 h-5 text-orange-600 shrink-0" />
          <div>
            <h2 className="text-sm font-bold text-gray-900">T-Soft mağaza siparişleri</h2>
            <p className="text-xs text-gray-600 mt-0.5">
              Yenile ile mağazadan siparişleri çekip CRM listesine aktarır.
            </p>
          </div>
        </div>
        <span className="text-[11px] font-medium text-orange-700 shrink-0 group-open:hidden">Aç</span>
        <span className="text-[11px] font-medium text-orange-700 shrink-0 hidden group-open:inline">Kapat</span>
      </summary>

      <div className="p-5 space-y-4">
        <div className="flex items-center justify-end">
          <button
            type="button"
            disabled={syncing}
            onClick={refreshAndSync}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white border border-orange-200 text-orange-800 hover:bg-orange-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/80">
            <h3 className="font-medium text-gray-900 text-sm">Mağaza sipariş listesi (T-Soft)</h3>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Yükleniyor…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-center py-12 text-gray-400 text-sm">Kayıt yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-semibold text-gray-500 uppercase">
                    <th className="px-4 py-2.5">Sipariş</th>
                    <th className="px-4 py-2.5">Mağaza no</th>
                    <th className="px-4 py-2.5">Müşteri</th>
                    <th className="px-4 py-2.5">Durum</th>
                    <th className="px-4 py-2.5 text-right">Tutar</th>
                    <th className="px-4 py-2.5">Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const s = summarize(r);
                    return (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="px-4 py-2.5 font-medium text-gray-900">{s.no}</td>
                        <td className="px-4 py-2.5 text-xs font-mono text-gray-600">{s.numericId || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-700">{s.customer || '—'}</td>
                        <td className="px-4 py-2.5">
                          {s.status ? (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                              {s.status}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 text-right">{s.total ? `${s.total} TL` : '—'}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{s.date || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50/30">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
              Önceki
            </button>
            <span className="text-xs text-gray-500">Sayfa {page}</span>
            <button
              type="button"
              disabled={loading || rows.length < 50}
              onClick={() => setPage((p) => p + 1)}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40"
            >
              Sonraki
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}
