'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Users,
  Download,
  MessageCircle,
  Store,
  Briefcase,
} from 'lucide-react';

type SiteOrderRow = Record<string, unknown>;

type PickOrder = {
  id: string;
  orderNumber: number;
  grandTotal: number;
  currency: string;
  status: string;
  source: string;
  tsoftSiteOrderId: string | null;
  contact: { name: string | null; surname: string | null; phone: string };
};

type Props = {
  /** URL’den ?tsoft=1 ile açılsın */
  defaultOpen?: boolean;
  /** CRM sipariş listesi yenilendiğinde (senkron sonrası) */
  onCrmOrdersSynced?: () => void;
};

export default function TsoftStoreOrdersPanel({ defaultOpen = false, onCrmOrdersSynced }: Props) {
  const [panelOpen, setPanelOpen] = useState(defaultOpen);
  useEffect(() => {
    setPanelOpen(defaultOpen);
  }, [defaultOpen]);

  const [rows, setRows] = useState<unknown[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<'orders' | 'customers' | null>(null);

  const [statuses, setStatuses] = useState<Record<string, unknown>[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);

  const [picklist, setPicklist] = useState<PickOrder[]>([]);
  const [pickLoading, setPickLoading] = useState(false);

  const [selectedSite, setSelectedSite] = useState<SiteOrderRow | null>(null);
  const [statusChoice, setStatusChoice] = useState('');
  const [crmChoice, setCrmChoice] = useState<string>('');

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

  const loadPicklist = useCallback(async () => {
    setPickLoading(true);
    try {
      const { data } = await api.get('/ecommerce/tsoft/crm-orders-picklist', { params: { limit: 30 } });
      setPicklist(Array.isArray(data?.orders) ? data.orders : []);
    } catch {
      toast.error('CRM sipariş listesi alınamadı');
      setPicklist([]);
    } finally {
      setPickLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page);
  }, [page, load]);

  useEffect(() => {
    loadStatuses();
    loadPicklist();
  }, [loadStatuses, loadPicklist]);

  const syncOrders = async () => {
    setSyncing('orders');
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-orders', {}, { timeout: 120_000 });
      const max = data?.maxPerSync != null ? ` (en fazla ${data.maxPerSync} sipariş)` : '';
      toast.success(
        `Siparişler CRM’e aktarıldı: ${data.imported} yeni, ${data.skippedExisting} zaten kayıtlı, ${data.errors || 0} hata${max}`,
      );
      await loadPicklist();
      onCrmOrdersSynced?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Aktarım başarısız');
    } finally {
      setSyncing(null);
    }
  };

  const syncCustomers = async () => {
    setSyncing('customers');
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-customers', {}, { timeout: 120_000 });
      toast.success(
        `Müşteriler: ${data.matched} güncellendi, ${data.created || 0} yeni kişi. T-Soft’tan ${data.tsoftCustomerCount ?? data.maxPerSync ?? 0} kayıt okundu.`,
      );
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Müşteri aktarımı başarısız');
    } finally {
      setSyncing(null);
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

  const statusLabel = (s: Record<string, unknown>) => {
    const id = s.OrderStatusId ?? s.orderStatusId ?? s.Id ?? s.id;
    const name = s.OrderStatus ?? s.Title ?? s.Name ?? s.name ?? '';
    return `${id != null ? id : '?'}${name ? ` — ${name}` : ''}`;
  };

  const statusValue = (s: Record<string, unknown>) =>
    String(s.OrderStatusId ?? s.orderStatusId ?? s.Id ?? s.id ?? '').trim();

  const selectedNumericId = useMemo(() => {
    if (!selectedSite) return NaN;
    const o = selectedSite as Record<string, unknown>;
    const n = Number(o.OrderId ?? o.orderId);
    return Number.isFinite(n) ? n : NaN;
  }, [selectedSite]);

  const applySiteStatus = async () => {
    if (!Number.isFinite(selectedNumericId) || selectedNumericId <= 0) {
      toast.error('Önce tablodan bir sipariş seçin');
      return;
    }
    const st = statusChoice.trim();
    if (!st) {
      toast.error('Yeni durumu seçin');
      return;
    }
    try {
      await api.post('/ecommerce/tsoft/site-orders/status', {
        orderNumericId: selectedNumericId,
        orderStatusId: st,
      });
      toast.success('Mağaza siparişinin durumu güncellendi');
      await load(page);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Güncellenemedi');
    }
  };

  const deleteSiteOrder = async () => {
    if (!Number.isFinite(selectedNumericId) || selectedNumericId <= 0) {
      toast.error('Önce tablodan bir sipariş seçin');
      return;
    }
    if (!window.confirm('Bu siparişi mağazadan (T-Soft) silmek istediğinize emin misiniz?')) return;
    try {
      await api.post('/ecommerce/tsoft/site-orders/delete', { orderId: selectedNumericId });
      toast.success('Mağaza siparişi silindi');
      setSelectedSite(null);
      await load(page);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Silinemedi');
    }
  };

  const selectedCrmId = crmChoice || '';

  const pushCrmToSite = async () => {
    if (!selectedCrmId) {
      toast.error('Aşağıdan bir CRM siparişi seçin');
      return;
    }
    try {
      const { data } = await api.post('/ecommerce/tsoft/crm-orders/push', { salesOrderId: selectedCrmId });
      toast.success(
        data?.tsoftSiteOrderId
          ? `Mağazaya gönderildi. Mağaza sipariş no: ${data.tsoftSiteOrderId}`
          : 'İstek tamamlandı',
      );
      await loadPicklist();
      await load(page);
      onCrmOrdersSynced?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Gönderilemedi');
    }
  };

  const deleteCrmLinkedSiteOrder = async () => {
    if (!selectedCrmId) {
      toast.error('Önce CRM siparişi seçin');
      return;
    }
    if (!window.confirm('Bu CRM kaydına bağlı mağaza siparişi silinsin mi?')) return;
    try {
      await api.post('/ecommerce/tsoft/crm-orders/delete-site', { salesOrderId: selectedCrmId });
      toast.success('Mağaza siparişi silindi');
      await loadPicklist();
      onCrmOrdersSynced?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Silinemedi');
    }
  };

  const setCrmLinkedStatus = async () => {
    if (!selectedCrmId) {
      toast.error('CRM siparişi seçin');
      return;
    }
    const st = statusChoice.trim();
    if (!st) {
      toast.error('Yukarıdaki durum listesinden bir durum seçin');
      return;
    }
    try {
      await api.patch(`/ecommerce/tsoft/crm-orders/${selectedCrmId}/site-status`, { orderStatusId: st });
      toast.success('Bağlı mağaza siparişinin durumu güncellendi');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Güncellenemedi');
    }
  };

  const crmLabel = (o: PickOrder) => {
    const name = [o.contact?.name, o.contact?.surname].filter(Boolean).join(' ') || o.contact?.phone || 'Müşteri';
    let site = '';
    if (o.tsoftSiteOrderId) site = ` · Mağaza #${o.tsoftSiteOrderId}`;
    return `SIP-${String(o.orderNumber).padStart(5, '0')} · ${name} · ${o.grandTotal} ${o.currency}${site}`;
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
            <h2 className="text-sm font-bold text-gray-900">T-Soft mağaza araçları</h2>
            <p className="text-xs text-gray-600 mt-0.5">
              Mağazadan gelen siparişleri çekin, CRM ile eşleştirin veya mağaza tarafında durum güncelleyin.
            </p>
          </div>
        </div>
        <span className="text-[11px] font-medium text-orange-700 shrink-0 group-open:hidden">Aç</span>
        <span className="text-[11px] font-medium text-orange-700 shrink-0 hidden group-open:inline">Kapat</span>
      </summary>

      <div className="p-5 space-y-6">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={syncing !== null}
            onClick={syncCustomers}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-50 text-blue-800 hover:bg-blue-100 disabled:opacity-50"
          >
            {syncing === 'customers' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            Müşterileri CRM’e al
          </button>
          <button
            type="button"
            disabled={syncing !== null}
            onClick={syncOrders}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-orange-50 text-orange-800 hover:bg-orange-100 disabled:opacity-50"
          >
            {syncing === 'orders' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Siparişleri CRM’e aktar
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => load(page)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-50 text-gray-800 hover:bg-gray-100"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Mağaza listesini yenile
          </button>
          <Link
            href="/inbox"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          >
            <MessageCircle className="w-4 h-4" />
            Gelen kutusu
          </Link>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-gray-900 font-semibold text-sm">
              <Store className="w-4 h-4 text-orange-500" />
              Seçilen mağaza siparişi
            </div>
            <p className="text-xs text-gray-500">
              Aşağıdaki tablodan satır seçin. <strong>Mağaza sipariş no</strong> T-Soft’taki numerik kimliktir.
            </p>
            {selectedSite ? (
              <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-1">
                <div>
                  <span className="text-gray-500">Sipariş / kod:</span>{' '}
                  <strong>{summarize(selectedSite).no}</strong>
                </div>
                <div>
                  <span className="text-gray-500">Mağaza sipariş no:</span>{' '}
                  <strong className="font-mono">{summarize(selectedSite).numericId || '—'}</strong>
                </div>
                <div>
                  <span className="text-gray-500">Müşteri:</span> {summarize(selectedSite).customer || '—'}
                </div>
              </div>
            ) : (
              <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                Henüz seçim yok — tablodan bir satıra tıklayın.
              </p>
            )}

            <label className="block text-xs text-gray-600">
              Yeni durum
              {statusLoading && <Loader2 className="inline w-3 h-3 animate-spin ml-1" />}
              <select
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                value={statusChoice}
                onChange={(e) => setStatusChoice(e.target.value)}
              >
                <option value="">Seçin…</option>
                {statuses.map((s, i) => (
                  <option key={i} value={statusValue(s) || `idx-${i}`}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={applySiteStatus}
                className="px-3 py-2 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Durumu güncelle
              </button>
              <button
                type="button"
                onClick={deleteSiteOrder}
                className="px-3 py-2 rounded-lg text-sm bg-red-50 text-red-800 hover:bg-red-100"
              >
                Mağazadan sil
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-gray-900 font-semibold text-sm">
              <Briefcase className="w-4 h-4 text-violet-600" />
              CRM siparişini mağazaya bağla
            </div>
            <p className="text-xs text-gray-500">
              Panel siparişini mağazaya gönderin veya bağlı siparişin durumunu güncelleyin.{' '}
              <Link href="/inbox" className="text-orange-600 underline">
                Gelen kutusu
              </Link>
            </p>
            <label className="block text-xs text-gray-600">
              CRM siparişi
              {pickLoading && <Loader2 className="inline w-3 h-3 animate-spin ml-1" />}
              <select
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                value={crmChoice}
                onChange={(e) => setCrmChoice(e.target.value)}
              >
                <option value="">Seçin…</option>
                {picklist.map((o) => (
                  <option key={o.id} value={o.id}>
                    {crmLabel(o)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={pushCrmToSite}
                className="px-3 py-2 rounded-lg text-sm bg-green-600 text-white hover:bg-green-700"
              >
                Mağazaya gönder
              </button>
              <button
                type="button"
                onClick={setCrmLinkedStatus}
                className="px-3 py-2 rounded-lg text-sm bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
              >
                Bağlı siparişin durumunu güncelle
              </button>
              <button
                type="button"
                onClick={deleteCrmLinkedSiteOrder}
                className="px-3 py-2 rounded-lg text-sm bg-red-50 text-red-800 hover:bg-red-100"
              >
                Mağaza bağlantısını sil
              </button>
            </div>
            <button type="button" onClick={loadPicklist} className="text-xs text-gray-500 underline">
              Listeyi yenile
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/80">
            <h3 className="font-medium text-gray-900 text-sm">Mağaza sipariş listesi (T-Soft)</h3>
            <p className="text-xs text-gray-500 mt-0.5">Satıra tıklayarak seçin.</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Yükleniyor…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-center py-12 text-gray-400 text-sm">Kayıt yok veya yanıt beklenen formatta değil.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-semibold text-gray-500 uppercase">
                    <th className="px-4 py-2.5 w-10" />
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
                    const sel =
                      selectedSite &&
                      typeof selectedSite === 'object' &&
                      String((selectedSite as Record<string, unknown>).OrderId ?? '') === s.numericId;
                    return (
                      <tr
                        key={i}
                        onClick={() => {
                          setSelectedSite(r as SiteOrderRow);
                          setStatusChoice('');
                        }}
                        className={`border-b border-gray-50 cursor-pointer hover:bg-orange-50/50 ${sel ? 'bg-orange-50' : ''}`}
                      >
                        <td className="px-4 py-2.5 text-xs text-orange-500">{sel ? '●' : ''}</td>
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
