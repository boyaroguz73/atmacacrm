'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api, { getApiErrorMessage } from '@/lib/api';
import { formatPhone, backendPublicUrl, rewriteMediaUrlForClient } from '@/lib/utils';
import {
  ArrowLeft,
  FileText,
  Send,
  ShoppingCart,
  CheckCircle2,
  XCircle,
  Loader2,
  User,
  Calendar,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

const CURRENCY: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€' };
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Taslak', cls: 'bg-gray-100 text-gray-600' },
  SENT: { label: 'Gönderildi', cls: 'bg-blue-50 text-blue-600' },
  ACCEPTED: { label: 'Kabul Edildi', cls: 'bg-green-50 text-green-600' },
  REJECTED: { label: 'Reddedildi', cls: 'bg-red-50 text-red-600' },
  EXPIRED: { label: 'Süresi Doldu', cls: 'bg-amber-50 text-amber-600' },
};

type PaymentModeUI = 'FULL' | 'DEPOSIT_50';

export default function QuoteDetailPage() {
  const { user } = useAuthStore();
  const canConvertToOrder =
    user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' || user?.role === 'ACCOUNTANT';
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [quote, setQuote] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [validUntilInput, setValidUntilInput] = useState('');
  const [deliveryDateInput, setDeliveryDateInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [documentKindSelect, setDocumentKindSelect] = useState<'PROFORMA' | 'QUOTE'>('PROFORMA');
  const [metaSaving, setMetaSaving] = useState(false);
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [acceptPaymentMode, setAcceptPaymentMode] = useState<PaymentModeUI>('FULL');

  const fetchQuote = async () => {
    try {
      const { data } = await api.get(`/quotes/${id}`);
      setQuote(data);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Teklif yüklenemedi'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchQuote();
  }, [id]);

  useEffect(() => {
    if (!quote) return;
    setValidUntilInput(toDateInputValue(quote.validUntil));
    setDeliveryDateInput(toDateInputValue(quote.deliveryDate));
    setNotesInput(quote.notes != null ? String(quote.notes) : '');
    const dk = quote.documentKind === 'QUOTE' ? 'QUOTE' : 'PROFORMA';
    setDocumentKindSelect(dk);
  }, [quote?.id, quote?.validUntil, quote?.deliveryDate, quote?.notes, quote?.documentKind]);

  const saveMeta = async () => {
    setMetaSaving(true);
    try {
      const { data } = await api.patch(`/quotes/${id}`, {
        validUntil: validUntilInput ? new Date(validUntilInput).toISOString() : null,
        deliveryDate: deliveryDateInput ? new Date(deliveryDateInput).toISOString() : null,
        notes: notesInput.trim() === '' ? null : notesInput,
        documentKind: documentKindSelect,
      });
      setQuote(data);
      toast.success('Bilgiler kaydedildi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kayıt başarısız'));
    } finally {
      setMetaSaving(false);
    }
  };

  const handleAction = async (action: string) => {
    setActionLoading(action);
    try {
      if (action === 'generate-pdf') {
        const { data } = await api.post(`/quotes/${id}/generate-pdf`);
        toast.success('PDF oluşturuldu');
        setQuote((q: any) => ({ ...q, pdfUrl: data.pdfUrl }));
      } else if (action === 'send') {
        await api.post(`/quotes/${id}/send`, {});
        toast.success('Teklif WhatsApp ile gönderildi');
        void fetchQuote();
      } else if (action === 'reject') {
        await api.patch(`/quotes/${id}/status`, { status: 'REJECTED' });
        toast.success('Teklif reddedildi');
        void fetchQuote();
      } else if (action === 'convert') {
        await api.post(`/quotes/${id}/convert-to-order`);
        toast.success('Sipariş oluşturuldu');
        router.push('/orders');
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'İşlem başarısız'));
    } finally {
      setActionLoading('');
    }
  };

  const confirmAccept = async () => {
    setActionLoading('accept');
    try {
      await api.patch(`/quotes/${id}/status`, {
        status: 'ACCEPTED',
        paymentMode: acceptPaymentMode,
        documentKind: documentKindSelect,
      });
      toast.success('Teklif kabul edildi');
      setShowAcceptModal(false);
      void fetchQuote();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kabul başarısız'));
    } finally {
      setActionLoading('');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-whatsapp" />
      </div>
    );
  }
  if (!quote) return <div className="p-6 text-gray-500">Teklif bulunamadı</div>;

  const cs = CURRENCY[quote.currency] || quote.currency;
  const badge = STATUS_BADGE[quote.status] || STATUS_BADGE.DRAFT;
  const fmt = (v: number) => `${cs} ${v.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
  const c = quote.contact || {};
  const pdfBase = backendPublicUrl();
  const halfDeposit = Math.round((quote.grandTotal * 0.5) * 100) / 100;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-5xl mx-auto pb-16">
      {showAcceptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-bold text-gray-900">Teklifi kabul et</h2>
              <button
                type="button"
                onClick={() => setShowAcceptModal(false)}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-500"
                aria-label="Kapat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600">
              Ödeme modelini seçin. %50 ön ödemede, siparişte teslim tarihi varsa teslimden bir gün önce muhasebeciye
              otomatik görev oluşturulur.
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="pay"
                  checked={acceptPaymentMode === 'FULL'}
                  onChange={() => setAcceptPaymentMode('FULL')}
                />
                <div>
                  <p className="font-medium text-gray-900">Tam ödeme</p>
                  <p className="text-xs text-gray-500">Toplam {fmt(quote.grandTotal)}</p>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="pay"
                  checked={acceptPaymentMode === 'DEPOSIT_50'}
                  onChange={() => setAcceptPaymentMode('DEPOSIT_50')}
                />
                <div>
                  <p className="font-medium text-gray-900">%50 ön ödeme</p>
                  <p className="text-xs text-gray-500">
                    Ön ödeme ≈ {fmt(halfDeposit)} · Kalan teslim öncesi tahsil edilmeli
                  </p>
                </div>
              </label>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowAcceptModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={!!actionLoading}
                onClick={() => void confirmAccept()}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-whatsapp text-white hover:bg-green-600 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {actionLoading === 'accept' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Onayla
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border border-gray-100 bg-white shadow-sm p-4 md:p-5">
        <button
          type="button"
          onClick={() => router.push('/quotes')}
          className="p-2 shrink-0 rounded-xl border border-gray-200 hover:bg-gray-50"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 tracking-tight">
            TKL-{String(quote.quoteNumber).padStart(5, '0')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {[c.name, c.surname].filter(Boolean).join(' ') || formatPhone(c.phone)} —{' '}
            {new Date(quote.createdAt).toLocaleString('tr-TR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          {quote.createdBy?.name ? (
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              <User className="w-3.5 h-3.5 shrink-0" />
              Oluşturan: <span className="font-medium text-gray-600">{quote.createdBy.name}</span>
            </p>
          ) : null}
        </div>
        <span className={`self-start sm:self-center px-3 py-1 rounded-full text-xs font-medium ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-3 w-16">Görsel</th>
                    <th className="text-left px-4 py-3">#</th>
                    <th className="text-left px-4 py-3">Ürün / Hizmet</th>
                    <th className="text-right px-4 py-3">Miktar</th>
                    <th className="text-right px-4 py-3">Birim Fiyat</th>
                    <th className="text-right px-4 py-3">KDV</th>
                    <th className="text-right px-4 py-3">İndirim</th>
                    <th className="text-right px-4 py-3">Toplam</th>
                  </tr>
                </thead>
                <tbody>
                  {(quote.items || []).map((item: any, i: number) => (
                    <tr key={item.id} className="border-t border-gray-50">
                      <td className="px-4 py-2.5 w-16 align-middle">
                        <div className="w-12 h-12 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden shrink-0">
                          {item.product?.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={rewriteMediaUrlForClient(item.product.imageUrl)}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="flex w-full h-full items-center justify-center text-[10px] text-gray-300">
                              —
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-900">{item.name}</p>
                        {item.description && <p className="text-xs text-gray-400">{item.description}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-right">{item.quantity}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(item.unitPrice)}</td>
                      <td className="px-4 py-2.5 text-right">%{item.vatRate}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">
                        {item.discountValue
                          ? item.discountType === 'AMOUNT'
                            ? fmt(item.discountValue)
                            : `%${item.discountValue}`
                          : '-'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">{fmt(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 md:p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <Calendar className="w-4 h-4 text-whatsapp" />
              Tarihler, belge türü ve notlar
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Geçerlilik tarihi</label>
                <input
                  type="date"
                  value={validUntilInput}
                  onChange={(e) => setValidUntilInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Teslim tarihi</label>
                <input
                  type="date"
                  value={deliveryDateInput}
                  onChange={(e) => setDeliveryDateInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">PDF başlığı (belge türü)</label>
              <select
                value={documentKindSelect}
                onChange={(e) => setDocumentKindSelect(e.target.value as 'PROFORMA' | 'QUOTE')}
                className="w-full max-w-xs px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
              >
                <option value="PROFORMA">Proforma teklif</option>
                <option value="QUOTE">Satış teklifi</option>
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Kaydettikten sonra PDF oluşturduğunuzda başlık buna göre gelir.</p>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Notlar</label>
              <textarea
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                rows={3}
                placeholder="Teklif notları…"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp resize-y min-h-[72px]"
              />
            </div>
            <button
              type="button"
              disabled={metaSaving}
              onClick={() => void saveMeta()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              {metaSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Kaydet
            </button>
            <p className="text-[11px] text-gray-400">
              PDF daha önce oluşturulduysa tarih veya belge türü değişince PDF’i yeniden oluşturmanız gerekir.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Ara Toplam</span>
              <span>{fmt(quote.subtotal)}</span>
            </div>
            {quote.discountTotal > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">İndirim</span>
                <span className="text-red-500">-{fmt(quote.discountTotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">KDV</span>
              <span>{fmt(quote.vatTotal)}</span>
            </div>
            <div className="border-t pt-3 flex justify-between">
              <span className="font-bold text-gray-900">GENEL TOPLAM</span>
              <span className="font-bold text-lg text-whatsapp">{fmt(quote.grandTotal)}</span>
            </div>
            {quote.status === 'ACCEPTED' && (
              <div className="pt-2 border-t text-xs text-gray-600 space-y-1">
                <p>
                  <span className="text-gray-500">Ödeme: </span>
                  {quote.paymentMode === 'DEPOSIT_50' ? '%50 ön ödeme' : 'Tam ödeme'}
                </p>
                {quote.acceptedAt && (
                  <p>
                    <span className="text-gray-500">Kabul: </span>
                    {new Date(quote.acceptedAt).toLocaleString('tr-TR')}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3 text-sm">
            <p className="text-gray-500">Müşteri</p>
            <p className="font-medium text-gray-900">{[c.name, c.surname].filter(Boolean).join(' ') || '-'}</p>
            {c.company && <p className="text-gray-600">{c.company}</p>}
            <p className="text-gray-600">{formatPhone(c.phone)}</p>
            {c.email && <p className="text-gray-600">{c.email}</p>}
            {quote.validUntil && (
              <p className="text-xs text-gray-400">
                Geçerlilik: {new Date(quote.validUntil).toLocaleDateString('tr-TR')}
              </p>
            )}
            {quote.deliveryDate && (
              <p className="text-xs text-gray-400">Teslim: {new Date(quote.deliveryDate).toLocaleDateString('tr-TR')}</p>
            )}
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void handleAction('generate-pdf')}
              disabled={!!actionLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-50 text-purple-700 rounded-xl text-sm font-medium hover:bg-purple-100 disabled:opacity-50"
            >
              {actionLoading === 'generate-pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              PDF Oluştur
            </button>

            {quote.pdfUrl && (
              <a
                href={`${pdfBase}${quote.pdfUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-50 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-100"
              >
                <FileText className="w-4 h-4" /> PDF Görüntüle
              </a>
            )}

            <button
              type="button"
              onClick={() => void handleAction('send')}
              disabled={!!actionLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-whatsapp text-white rounded-xl text-sm font-medium hover:bg-green-600 disabled:opacity-50"
            >
              {actionLoading === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              WhatsApp ile Gönder
            </button>

            {quote.status === 'SENT' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setAcceptPaymentMode('FULL');
                    setShowAcceptModal(true);
                  }}
                  disabled={!!actionLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-50 text-green-700 rounded-xl text-sm font-medium hover:bg-green-100 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" /> Kabul et…
                </button>
                <button
                  type="button"
                  onClick={() => void handleAction('reject')}
                  disabled={!!actionLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-700 rounded-xl text-sm font-medium hover:bg-red-100 disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" /> Reddet
                </button>
              </>
            )}

            {quote.status === 'ACCEPTED' && canConvertToOrder && (
              <button
                type="button"
                onClick={() => void handleAction('convert')}
                disabled={!!actionLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-50 text-orange-700 rounded-xl text-sm font-medium hover:bg-orange-100 disabled:opacity-50"
              >
                {actionLoading === 'convert' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                Siparişe Dönüştür
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
