'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  ShoppingBag,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  X,
  MessageCircle,
  Eye,
  Plus,
  User,
  Package,
  Phone,
  MapPin,
  Tag,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TsoftOrderItem {
  id: string;
  name: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  imageUrl?: string;
}

interface TsoftContact {
  id: string;
  name?: string;
  phone: string;
  avatarUrl?: string;
  email?: string;
}

interface TsoftOrder {
  id: string;
  tsoftId: string;
  orderNumber?: string;
  status: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  currency: string;
  grandTotal: number;
  subtotal: number;
  shippingTotal: number;
  notes?: string;
  tsoftCreatedAt?: string;
  createdAt: string;
  sentAutoReply: boolean;
  contact?: TsoftContact;
  items?: TsoftOrderItem[];
  billingAddress?: Record<string, unknown>;
  shippingAddress?: Record<string, unknown>;
}

interface OrdersResponse {
  orders: TsoftOrder[];
  total: number;
  page: number;
  pages: number;
  limit: number;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  'Yeni': 'bg-blue-100 text-blue-700',
  'Onaylandı': 'bg-green-100 text-green-700',
  'Hazırlanıyor': 'bg-yellow-100 text-yellow-700',
  'Kargoya Verildi': 'bg-indigo-100 text-indigo-700',
  'Teslim Edildi': 'bg-emerald-100 text-emerald-700',
  'İptal': 'bg-red-100 text-red-700',
  'İade': 'bg-orange-100 text-orange-700',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {status}
    </span>
  );
}

function SiteBadge() {
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
      Site Siparişi
    </span>
  );
}

// ─── Order Detail Modal ───────────────────────────────────────────────────────

function OrderDetailModal({ order, onClose, onOpenChat }: {
  order: TsoftOrder;
  onClose: () => void;
  onOpenChat: (contactId: string) => void;
}) {
  const billing = order.billingAddress as Record<string, string> | undefined;
  const shipping = order.shippingAddress as Record<string, string> | undefined;

  const fullAddress = (addr?: Record<string, string>) => {
    if (!addr) return null;
    return [addr.address, addr.district, addr.city, addr.country]
      .filter(Boolean)
      .join(', ');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
              <ShoppingBag className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900 text-base">
                  #{order.orderNumber || order.tsoftId}
                </span>
                <SiteBadge />
                <StatusBadge status={order.status} />
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {order.tsoftCreatedAt
                  ? new Date(order.tsoftCreatedAt).toLocaleString('tr-TR')
                  : new Date(order.createdAt).toLocaleString('tr-TR')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Customer & Chat */}
          <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center font-semibold text-orange-700 text-sm uppercase">
                {order.contact?.name?.[0] ?? order.customerName?.[0] ?? <User className="w-4 h-4" />}
              </div>
              <div>
                <p className="font-semibold text-gray-900 text-sm">
                  {order.contact?.name || order.customerName || 'İsimsiz Müşteri'}
                </p>
                {(order.contact?.phone || order.customerPhone) && (
                  <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                    <Phone className="w-3 h-3" />
                    {order.contact?.phone || order.customerPhone}
                  </p>
                )}
                {order.customerEmail && (
                  <p className="text-xs text-gray-400">{order.customerEmail}</p>
                )}
              </div>
            </div>
            {order.contact?.id && (
              <button
                onClick={() => onOpenChat(order.contact!.id)}
                className="flex items-center gap-1.5 px-3 py-2 bg-green-500 text-white rounded-xl text-xs font-medium hover:bg-green-600 transition-colors shrink-0"
              >
                <MessageCircle className="w-4 h-4" />
                Sohbet Aç
              </button>
            )}
          </div>

          {/* Amounts */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400 mb-1">Ara Toplam</p>
              <p className="font-bold text-gray-900">{order.subtotal.toFixed(2)} {order.currency}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400 mb-1">Kargo</p>
              <p className="font-bold text-gray-900">{order.shippingTotal.toFixed(2)} {order.currency}</p>
            </div>
            <div className="bg-orange-50 rounded-xl p-3 text-center">
              <p className="text-xs text-orange-500 mb-1">Genel Toplam</p>
              <p className="font-bold text-orange-700 text-lg">{order.grandTotal.toFixed(2)} {order.currency}</p>
            </div>
          </div>

          {/* Items */}
          {order.items && order.items.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <Package className="w-4 h-4 text-gray-400" />
                Ürünler ({order.items.length})
              </h3>
              <div className="space-y-2">
                {order.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-10 h-10 rounded-lg object-cover bg-white" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-white border border-gray-100 flex items-center justify-center">
                        <Package className="w-4 h-4 text-gray-300" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                      {item.sku && <p className="text-xs text-gray-400">SKU: {item.sku}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-gray-500">{item.quantity} × {item.unitPrice.toFixed(2)} {order.currency}</p>
                      <p className="text-sm font-semibold text-gray-900">{item.lineTotal.toFixed(2)} {order.currency}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Addresses */}
          {(billing || shipping) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {billing && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1">
                    <Tag className="w-3 h-3" /> Fatura Adresi
                  </p>
                  <p className="text-xs text-gray-700">{fullAddress(billing as Record<string, string>) || JSON.stringify(billing)}</p>
                </div>
              )}
              {shipping && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Teslimat Adresi
                  </p>
                  <p className="text-xs text-gray-700">{fullAddress(shipping as Record<string, string>) || JSON.stringify(shipping)}</p>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {order.notes && (
            <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3">
              <p className="text-xs font-semibold text-yellow-700 mb-1">Not</p>
              <p className="text-sm text-gray-700">{order.notes}</p>
            </div>
          )}

          {/* Auto Reply Status */}
          {order.sentAutoReply && (
            <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 rounded-xl px-3 py-2">
              <MessageCircle className="w-3.5 h-3.5" />
              Otomatik yanıt gönderildi
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Create Order Modal ───────────────────────────────────────────────────────

function CreateOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ name: '', sku: '', quantity: 1, unitPrice: 0 }]);
  const [saving, setSaving] = useState(false);

  const addItem = () => setItems((p) => [...p, { name: '', sku: '', quantity: 1, unitPrice: 0 }]);
  const removeItem = (i: number) => setItems((p) => p.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, value: any) =>
    setItems((p) => p.map((item, idx) => idx === i ? { ...item, [field]: value } : item));

  const grandTotal = items.reduce((s, i) => s + (i.quantity || 0) * (i.unitPrice || 0), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!items.some((i) => i.name.trim())) {
      toast.error('En az bir ürün ekleyin');
      return;
    }
    setSaving(true);
    try {
      await api.post('/ecommerce/tsoft/orders', {
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        shippingAddress: shippingAddress.trim() || undefined,
        notes: notes.trim() || undefined,
        items: items.filter((i) => i.name.trim()).map((i) => ({
          name: i.name.trim(),
          sku: i.sku.trim() || undefined,
          quantity: Number(i.quantity) || 1,
          unitPrice: Number(i.unitPrice) || 0,
        })),
      });
      toast.success('Sipariş T-Soft\'a gönderildi');
      onCreated();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Sipariş oluşturulamadı');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-orange-500" />
            <h2 className="font-bold text-gray-900">Yeni T-Soft Siparişi</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Customer */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Müşteri Adı</label>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400" placeholder="Ad Soyad" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Telefon</label>
              <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400" placeholder="905321234567" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">E-posta</label>
              <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400" placeholder="email@ornek.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Teslimat Adresi</label>
              <input value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400" placeholder="Adres" />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                <Package className="w-3.5 h-3.5" /> Ürünler
              </label>
              <button type="button" onClick={addItem}
                className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-800 font-medium">
                <Plus className="w-3.5 h-3.5" /> Ürün Ekle
              </button>
            </div>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-start">
                  <input value={item.name} onChange={(e) => updateItem(i, 'name', e.target.value)}
                    className="col-span-4 px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-orange-400" placeholder="Ürün adı *" required={i === 0} />
                  <input value={item.sku} onChange={(e) => updateItem(i, 'sku', e.target.value)}
                    className="col-span-2 px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-orange-400" placeholder="SKU" />
                  <input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)}
                    className="col-span-2 px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-orange-400" placeholder="Adet" />
                  <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(i, 'unitPrice', e.target.value)}
                    className="col-span-2 px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-orange-400" placeholder="Fiyat" />
                  <div className="col-span-1 flex items-center justify-end pt-1">
                    <span className="text-xs text-gray-500 font-medium">
                      {((item.quantity || 0) * (item.unitPrice || 0)).toFixed(0)} ₺
                    </span>
                  </div>
                  <button type="button" onClick={() => removeItem(i)} disabled={items.length === 1}
                    className="col-span-1 flex items-center justify-center text-gray-300 hover:text-red-400 disabled:opacity-20 pt-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            {grandTotal > 0 && (
              <p className="text-right text-sm font-bold text-orange-700 mt-2">
                Toplam: {grandTotal.toFixed(2)} TRY
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Not</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400 resize-none" placeholder="Sipariş notu..." />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
              İptal
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Siparişi Oluştur
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EcommerceOrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<TsoftOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const { data: res } = await api.get('/ecommerce/tsoft/synced-orders', {
        params: { page: p, limit: 20, search: q || undefined },
      });
      setData(res);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Siparişler yüklenemedi');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, search);
  }, [page, search, load]);

  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPage(1);
      setSearch(val);
    }, 400);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data: res } = await api.post('/ecommerce/tsoft/sync-orders');
      toast.success(`${res.created} yeni, ${res.updated} güncellendi, ${res.autoRepliesSent} yanıt`);
      load(1, search);
      setPage(1);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Sync başarısız');
    } finally {
      setSyncing(false);
    }
  };

  const openDetail = async (order: TsoftOrder) => {
    setDetailLoading(order.id);
    try {
      const { data: detail } = await api.get(`/ecommerce/tsoft/synced-orders/${order.id}`);
      setSelectedOrder(detail);
    } catch {
      setSelectedOrder(order);
    } finally {
      setDetailLoading(null);
    }
  };

  const openChat = (contactId: string) => {
    setSelectedOrder(null);
    router.push(`/inbox?contactId=${contactId}`);
  };

  const orders = data?.orders ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingBag className="w-7 h-7 text-orange-500" />
            E-Ticaret Siparişleri
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            T-Soft siparişleri {data ? `— ${data.total} sipariş` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-4 py-2 bg-orange-50 text-orange-700 rounded-xl text-sm font-medium hover:bg-orange-100 disabled:opacity-50"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Sync Et
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600"
          >
            <Plus className="w-4 h-4" />
            Yeni Sipariş
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Sipariş no, müşteri, telefon..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400"
        />
        {searchInput && (
          <button onClick={() => { setSearchInput(''); setPage(1); setSearch(''); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Yükleniyor…
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <ShoppingBag className="w-10 h-10 text-gray-200 mx-auto" />
            <p className="text-gray-400 text-sm">
              {search ? 'Arama sonucu bulunamadı' : 'Henüz sipariş yok — Sync Et butonunu kullanın'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                <th className="px-5 py-3">Sipariş</th>
                <th className="px-5 py-3">Müşteri</th>
                <th className="px-5 py-3">Durum</th>
                <th className="px-5 py-3">Tutar</th>
                <th className="px-5 py-3">Tarih</th>
                <th className="px-5 py-3 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-gray-50 hover:bg-orange-50/20 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">
                        #{order.orderNumber || order.tsoftId}
                      </span>
                      <SiteBadge />
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-xs font-semibold text-orange-700 uppercase shrink-0">
                        {order.contact?.name?.[0] ?? order.customerName?.[0] ?? '?'}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 text-sm leading-tight">
                          {order.contact?.name || order.customerName || 'İsimsiz'}
                        </p>
                        {(order.contact?.phone || order.customerPhone) && (
                          <p className="text-xs text-gray-400">{order.contact?.phone || order.customerPhone}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-5 py-3 font-semibold text-gray-900">
                    {order.grandTotal.toFixed(2)} {order.currency}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400">
                    {order.tsoftCreatedAt
                      ? new Date(order.tsoftCreatedAt).toLocaleDateString('tr-TR')
                      : new Date(order.createdAt).toLocaleDateString('tr-TR')}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {order.contact?.id && (
                        <button
                          onClick={() => openChat(order.contact!.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-medium hover:bg-green-100"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          Sohbet
                        </button>
                      )}
                      <button
                        onClick={() => openDetail(order)}
                        disabled={detailLoading === order.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 disabled:opacity-50"
                      >
                        {detailLoading === order.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                        Detay
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {data && data.pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/30">
            <button
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
              Önceki
            </button>
            <span className="text-xs text-gray-500">
              Sayfa {page} / {data.pages} · {data.total} sipariş
            </span>
            <button
              disabled={loading || page >= data.pages}
              onClick={() => setPage((p) => p + 1)}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40"
            >
              Sonraki
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onOpenChat={openChat}
        />
      )}
      {showCreate && (
        <CreateOrderModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { load(1, search); setPage(1); }}
        />
      )}
    </div>
  );
}
