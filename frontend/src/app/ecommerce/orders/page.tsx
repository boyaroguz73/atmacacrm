'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  ShoppingBag,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Users,
  Download,
  Send,
  Trash2,
  Settings2,
} from 'lucide-react';

type StatusRow = Record<string, unknown>;

export default function EcommerceOrdersPage() {
  const [rows, setRows] = useState<unknown[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<'orders' | 'customers' | null>(null);

  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);

  const [rawOrderId, setRawOrderId] = useState('');
  const [rawStatusId, setRawStatusId] = useState('');
  const [crmOrderId, setCrmOrderId] = useState('');

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const { data } = await api.get('/ecommerce/tsoft/orders', { params: { page: p, limit: 50 } });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Siparişler yüklenemedi');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatuses = useCallback(async () => {
    setStatusLoading(true);
    try {
      const { data } = await api.get('/ecommerce/tsoft/order-statuses');
      setStatuses(Array.isArray(data?.rows) ? data.rows : []);
    } catch {
      toast.error('Sipariş durumları yüklenemedi');
      setStatuses([]);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page);
  }, [page, load]);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  const syncOrders = async () => {
    setSyncing('orders');
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-orders', {}, { timeout: 120_000 });
      toast.success(
        `Sipariş senkronu: ${data.imported} aktarıldı, ${data.skippedExisting} zaten var, ${data.errors || 0} hata`,
      );
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Sipariş senkronu başarısız');
    } finally {
      setSyncing(null);
    }
  };

  const syncCustomers = async () => {
    setSyncing('customers');
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-customers', {}, { timeout: 120_000 });
      toast.success(
        `Müşteri senkronu: ${data.matched} eşleşti, ${data.created || 0} yeni, ${data.skipped || 0} atlandı`,
      );
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Müşteri senkronu başarısız');
    } finally {
      setSyncing(null);
    }
  };

  const deleteRawSiteOrder = async () => {
    const id = parseInt(rawOrderId.trim(), 10);
    if (!Number.isFinite(id) || id <= 0) {
      toast.error('Geçerli numerik sipariş ID girin (T-Soft OrderId)');
      return;
    }
    if (!window.confirm(`Sitedeki sipariş #${id} silinecek. Emin misiniz?`)) return;
    try {
      await api.post('/ecommerce/tsoft/site-orders/delete', { orderId: id });
      toast.success('Site siparişi silindi');
      await load(page);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Silinemedi');
    }
  };

  const setRawSiteOrderStatus = async () => {
    const id = parseInt(rawOrderId.trim(), 10);
    if (!Number.isFinite(id) || id <= 0) {
      toast.error('Geçerli numerik sipariş ID girin');
      return;
    }
    const st = rawStatusId.trim();
    if (!st) {
      toast.error('Durum kodu seçin veya yazın');
      return;
    }
    try {
      await api.post('/ecommerce/tsoft/site-orders/status', {
        orderNumericId: id,
        orderStatusId: st,
      });
      toast.success('Durum güncellendi');
      await load(page);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Güncellenemedi');
    }
  };

  const pushCrmToSite = async () => {
    const id = crmOrderId.trim();
    if (!id) {
      toast.error('CRM sipariş UUID girin');
      return;
    }
    try {
      const { data } = await api.post('/ecommerce/tsoft/crm-orders/push', { salesOrderId: id });
      toast.success(
        data?.tsoftSiteOrderId
          ? `Siteye gönderildi (OrderId: ${data.tsoftSiteOrderId})`
          : 'İstek tamam; yanıtı kontrol edin',
      );
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Gönderilemedi');
    }
  };

  const deleteCrmLinkedSiteOrder = async () => {
    const id = crmOrderId.trim();
    if (!id) {
      toast.error('CRM sipariş UUID girin');
      return;
    }
    if (!window.confirm('Bu CRM siparişine bağlı site siparişi silinsin mi?')) return;
    try {
      await api.post('/ecommerce/tsoft/crm-orders/delete-site', { salesOrderId: id });
      toast.success('Site siparişi silindi, CRM bağlantısı temizlendi');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Silinemedi');
    }
  };

  const setCrmLinkedStatus = async () => {
    const id = crmOrderId.trim();
    const st = rawStatusId.trim();
    if (!id || !st) {
      toast.error('CRM sipariş UUID ve durum kodu gerekli');
      return;
    }
    try {
      await api.patch(`/ecommerce/tsoft/crm-orders/${id}/site-status`, { orderStatusId: st });
      toast.success('Site sipariş durumu güncellendi');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Güncellenemedi');
    }
  };

  const summarize = (r: unknown) => {
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
  };

  const formatTsoftDate = (v: unknown): string => {
    if (!v) return '';
    if (typeof v === 'number' || (typeof v === 'string' && /^\d{10,}$/.test(v))) {
      const ts = Number(v);
      const d = new Date(ts < 1e12 ? ts * 1000 : ts);
      return d.toLocaleDateString('tr-TR');
    }
    const d = new Date(String(v));
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString('tr-TR') : String(v);
  };

  const statusLabel = (s: StatusRow) => {
    const id = s.OrderStatusId ?? s.orderStatusId ?? s.Id ?? s.id;
    const name = s.OrderStatus ?? s.Title ?? s.Name ?? s.name ?? '';
    return `${id != null ? id : '?'}${name ? ` — ${name}` : ''}`;
  };

  const statusValue = (s: StatusRow) => String(s.OrderStatusId ?? s.orderStatusId ?? s.Id ?? s.id ?? '').trim();

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingBag className="w-7 h-7 text-orange-500" />
            E-Ticaret Siparişleri
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Sitedeki siparişleri görüntüleyin; numerik ID ile durum güncelleme veya silme yapın. CRM siparişini siteye
            göndermek için sipariş kaydı UUID’sini kullanın.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={syncing !== null}
            onClick={syncCustomers}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition"
          >
            {syncing === 'customers' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            Müşteri Senkronu
          </button>
          <button
            type="button"
            disabled={syncing !== null}
            onClick={syncOrders}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50 transition"
          >
            {syncing === 'orders' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Sipariş Aktar
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => load(page)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-50 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-orange-500" />
            Site siparişi (numerik OrderId)
          </h2>
          <p className="text-xs text-gray-500">
            Tablodaki satırlardan OrderId kopyalayın veya aşağıya yazın. Durum listesi REST1&apos;den yüklenir.
          </p>
          <label className="block text-xs text-gray-600">
            Durumlar
            {statusLoading && <Loader2 className="inline w-3 h-3 animate-spin ml-1" />}
            <select
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
              value={rawStatusId}
              onChange={(e) => setRawStatusId(e.target.value)}
            >
              <option value="">Seçin…</option>
              {statuses.map((s, i) => (
                <option key={i} value={statusValue(s) || `idx-${i}`}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="OrderId (numerik)"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            value={rawOrderId}
            onChange={(e) => setRawOrderId(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={setRawSiteOrderStatus}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
            >
              Durumu güncelle
            </button>
            <button
              type="button"
              onClick={deleteRawSiteOrder}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-800 hover:bg-red-100"
            >
              <Trash2 className="w-4 h-4" />
              Siteden sil
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Send className="w-4 h-4 text-green-600" />
            CRM siparişi ↔ site
          </h2>
          <p className="text-xs text-gray-500">
            Siparişler sayfasındaki siparişin UUID değerini yapıştırın. Önce kişinin telefonu ile eşleşmiş olmalıdır.
          </p>
          <input
            type="text"
            placeholder="CRM SalesOrder UUID"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono"
            value={crmOrderId}
            onChange={(e) => setCrmOrderId(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={pushCrmToSite}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-green-50 text-green-800 hover:bg-green-100"
            >
              Siteye gönder
            </button>
            <button
              type="button"
              onClick={setCrmLinkedStatus}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
            >
              Bağlı site durumunu güncelle
            </button>
            <button
              type="button"
              onClick={deleteCrmLinkedSiteOrder}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-800 hover:bg-red-100"
            >
              Bağlı site siparişini sil
            </button>
          </div>
          <p className="text-[11px] text-gray-400">
            «Durumu güncelle» için üstteki durum seçimi + CRM UUID kullanılır (aynı durum kodu).
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Yükleniyor…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center py-16 text-gray-400 text-sm">
            Kayıt bulunamadı veya API yanıtı beklenen formatta değil.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="px-5 py-3">Sipariş</th>
                  <th className="px-5 py-3">OrderId</th>
                  <th className="px-5 py-3">Müşteri</th>
                  <th className="px-5 py-3">Durum</th>
                  <th className="px-5 py-3 text-right">Tutar</th>
                  <th className="px-5 py-3">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const s = summarize(r);
                  return (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/40">
                      <td className="px-5 py-3 font-medium text-gray-900">{s.no}</td>
                      <td className="px-5 py-3 text-xs font-mono text-gray-500">{s.numericId || '—'}</td>
                      <td className="px-5 py-3 text-gray-700">{s.customer || '—'}</td>
                      <td className="px-5 py-3">
                        {s.status ? (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                            {s.status}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-600 text-right">{s.total ? `${s.total} TL` : '—'}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{s.date || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/30">
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
  );
}
