'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api, { getApiErrorMessage } from '@/lib/api';
import { formatPhone } from '@/lib/utils';
import {
  ArrowLeft, FileText, Send, ShoppingCart, CheckCircle2, XCircle,
  Clock, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';

const CURRENCY: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€' };
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Taslak', cls: 'bg-gray-100 text-gray-600' },
  SENT: { label: 'Gönderildi', cls: 'bg-blue-50 text-blue-600' },
  ACCEPTED: { label: 'Kabul Edildi', cls: 'bg-green-50 text-green-600' },
  REJECTED: { label: 'Reddedildi', cls: 'bg-red-50 text-red-600' },
  EXPIRED: { label: 'Süresi Doldu', cls: 'bg-amber-50 text-amber-600' },
};

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [quote, setQuote] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');

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

  useEffect(() => { fetchQuote(); }, [id]);

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
        fetchQuote();
      } else if (action === 'accept') {
        await api.patch(`/quotes/${id}/status`, { status: 'ACCEPTED' });
        toast.success('Teklif kabul edildi');
        fetchQuote();
      } else if (action === 'reject') {
        await api.patch(`/quotes/${id}/status`, { status: 'REJECTED' });
        toast.success('Teklif reddedildi');
        fetchQuote();
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

  if (loading) return (
    <div className="flex items-center justify-center h-[60vh]">
      <Loader2 className="w-8 h-8 animate-spin text-whatsapp" />
    </div>
  );
  if (!quote) return <div className="p-6 text-gray-500">Teklif bulunamadı</div>;

  const cs = CURRENCY[quote.currency] || quote.currency;
  const badge = STATUS_BADGE[quote.status] || STATUS_BADGE.DRAFT;
  const fmt = (v: number) => `${cs} ${v.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
  const c = quote.contact || {};

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/quotes')} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">
            TKL-{String(quote.quoteNumber).padStart(5, '0')}
          </h1>
          <p className="text-sm text-gray-500">
            {[c.name, c.surname].filter(Boolean).join(' ') || formatPhone(c.phone)} — {new Date(quote.createdAt).toLocaleDateString('tr-TR')}
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${badge.cls}`}>{badge.label}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
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
                    <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900">{item.name}</p>
                      {item.description && <p className="text-xs text-gray-400">{item.description}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right">{item.quantity}</td>
                    <td className="px-4 py-2.5 text-right">{fmt(item.unitPrice)}</td>
                    <td className="px-4 py-2.5 text-right">%{item.vatRate}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">
                      {item.discountValue ? (item.discountType === 'AMOUNT' ? fmt(item.discountValue) : `%${item.discountValue}`) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">{fmt(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {quote.notes && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 font-medium mb-1">Notlar</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{quote.notes}</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-gray-500">Ara Toplam</span><span>{fmt(quote.subtotal)}</span></div>
            {quote.discountTotal > 0 && (
              <div className="flex justify-between text-sm"><span className="text-gray-500">İndirim</span><span className="text-red-500">-{fmt(quote.discountTotal)}</span></div>
            )}
            <div className="flex justify-between text-sm"><span className="text-gray-500">KDV</span><span>{fmt(quote.vatTotal)}</span></div>
            <div className="border-t pt-3 flex justify-between"><span className="font-bold text-gray-900">GENEL TOPLAM</span><span className="font-bold text-lg text-whatsapp">{fmt(quote.grandTotal)}</span></div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3 text-sm">
            <p className="text-gray-500">Müşteri</p>
            <p className="font-medium text-gray-900">{[c.name, c.surname].filter(Boolean).join(' ') || '-'}</p>
            {c.company && <p className="text-gray-600">{c.company}</p>}
            <p className="text-gray-600">{formatPhone(c.phone)}</p>
            {c.email && <p className="text-gray-600">{c.email}</p>}
            {quote.validUntil && <p className="text-xs text-gray-400">Geçerlilik: {new Date(quote.validUntil).toLocaleDateString('tr-TR')}</p>}
            {quote.deliveryDate && <p className="text-xs text-gray-400">Teslim: {new Date(quote.deliveryDate).toLocaleDateString('tr-TR')}</p>}
          </div>

          <div className="space-y-2">
            <button onClick={() => handleAction('generate-pdf')} disabled={!!actionLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-50 text-purple-700 rounded-xl text-sm font-medium hover:bg-purple-100 disabled:opacity-50">
              {actionLoading === 'generate-pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              PDF Oluştur
            </button>

            {quote.pdfUrl && (
              <a href={`${process.env.NEXT_PUBLIC_API_URL?.replace('/api', '')}${quote.pdfUrl}`} target="_blank" rel="noopener"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-50 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-100">
                <FileText className="w-4 h-4" /> PDF Görüntüle
              </a>
            )}

            <button onClick={() => handleAction('send')} disabled={!!actionLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-whatsapp text-white rounded-xl text-sm font-medium hover:bg-green-600 disabled:opacity-50">
              {actionLoading === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              WhatsApp ile Gönder
            </button>

            {quote.status === 'SENT' && (
              <>
                <button onClick={() => handleAction('accept')} disabled={!!actionLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-50 text-green-700 rounded-xl text-sm font-medium hover:bg-green-100 disabled:opacity-50">
                  <CheckCircle2 className="w-4 h-4" /> Kabul Edildi
                </button>
                <button onClick={() => handleAction('reject')} disabled={!!actionLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-700 rounded-xl text-sm font-medium hover:bg-red-100 disabled:opacity-50">
                  <XCircle className="w-4 h-4" /> Reddedildi
                </button>
              </>
            )}

            {quote.status === 'ACCEPTED' && (
              <button onClick={() => handleAction('convert')} disabled={!!actionLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-50 text-orange-700 rounded-xl text-sm font-medium hover:bg-orange-100 disabled:opacity-50">
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
