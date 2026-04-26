'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { getApiErrorMessage } from '@/lib/api';
import PanelEditedBadge from '@/components/ui/PanelEditedBadge';
import DateRangePicker from '@/components/ui/DateRangePicker';
import { useAuthStore } from '@/store/auth';
import { formatPhone } from '@/lib/utils';
import toast from 'react-hot-toast';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

interface QuoteRow {
  id: string;
  quoteNumber: number;
  status: QuoteStatus;
  currency: string;
  grandTotal: number;
  createdAt: string;
  panelEditedAt?: string | null;
  order?: { id: string } | null;
  validUntil?: string | null;
  deliveryDate?: string | null;
  createdBy?: { id: string; name: string | null } | null;
  contact: {
    id: string;
    name: string | null;
    surname: string | null;
    phone: string;
  };
}

const LIMIT = 10;

const STATUS_FILTERS: { key: '' | QuoteStatus; label: string }[] = [
  { key: '', label: 'Tümü' },
  { key: 'DRAFT', label: 'Taslak' },
  { key: 'SENT', label: 'Gönderildi' },
  { key: 'ACCEPTED', label: 'Kabul' },
  { key: 'REJECTED', label: 'Reddedildi' },
  { key: 'EXPIRED', label: 'Süresi Doldu' },
];

const STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: 'Taslak',
  SENT: 'Gönderildi',
  ACCEPTED: 'Kabul',
  REJECTED: 'Reddedildi',
  EXPIRED: 'Süresi Doldu',
};

function statusBadgeClass(status: QuoteStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-gray-100 text-gray-700 ring-gray-200';
    case 'SENT':
      return 'bg-blue-50 text-blue-700 ring-blue-200';
    case 'ACCEPTED':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    case 'REJECTED':
      return 'bg-red-50 text-red-700 ring-red-200';
    case 'EXPIRED':
      return 'bg-amber-50 text-amber-800 ring-amber-200';
    default:
      return 'bg-gray-100 text-gray-700 ring-gray-200';
  }
}

function contactDisplayName(q: QuoteRow): string {
  const full = [q.contact.name, q.contact.surname].filter(Boolean).join(' ').trim();
  return full || formatPhone(q.contact.phone);
}

function formatQuoteNo(n: number): string {
  return `TKL-${String(n).padStart(5, '0')}`;
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatMoney(amount: number, currency: string): string {
  const cur = currency || 'TRY';
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: cur === 'TRY' || cur === 'USD' || cur === 'EUR' ? cur : 'TRY',
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${cur === 'TRY' ? 'TL' : cur}`;
  }
}

export default function QuotesPage() {
  return <QuotesManager />;
}

function QuotesManager({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const { user } = useAuthStore();
  const canDeleteQuote = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'' | QuoteStatus>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: LIMIT };
      if (statusFilter) params.status = statusFilter;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      const { data } = await api.get('/quotes', { params });
      setQuotes(data.quotes ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast.error('Teklifler yüklenemedi');
      setQuotes([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, dateFrom, dateTo, searchQuery]);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, dateFrom, dateTo, searchQuery]);

  const goPage = (p: number) => {
    setPage(Math.min(Math.max(1, p), totalPages));
  };

  const deleteQuote = async (q: QuoteRow, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canDeleteQuote) return;
    if (!confirm(`Teklif ${formatQuoteNo(q.quoteNumber)} silinsin mi?`)) return;
    try {
      await api.delete(`/quotes/${q.id}`);
      toast.success('Teklif silindi');
      void fetchQuotes();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Silinemedi'));
    }
  };

  if (loading && quotes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[40vh]">
        <Loader2 className="w-9 h-9 text-whatsapp animate-spin" />
      </div>
    );
  }

  return (
    <div className={embedded ? 'space-y-6 w-full max-w-none p-0' : 'p-4 sm:p-6 space-y-6 w-full max-w-none'}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-7 h-7 text-whatsapp" />
            Teklifler
          </h1>
          <p className="text-gray-500 text-sm mt-1">Proforma ve satış teklifleri</p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/quotes/new')}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-whatsapp text-white rounded-xl text-sm font-semibold shadow-sm hover:bg-green-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Yeni Teklif
        </button>
      </div>

      <div className="flex flex-col xl:flex-row xl:items-center gap-4">
        <div className="flex flex-wrap gap-2 xl:flex-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key || 'all'}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                statusFilter === f.key
                  ? 'bg-whatsapp text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-whatsapp/40 hover:bg-green-50/50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 xl:justify-end">
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onChange={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
            }}
          />
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Kişi adı veya telefon..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-3 py-2 w-full sm:w-64 lg:w-72 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Teklif No</th>
                <th className="px-4 py-3">Kişi</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">Para Birimi</th>
                <th className="px-4 py-3 text-right">Genel Toplam</th>
                <th className="px-4 py-3">Geçerlilik</th>
                <th className="px-4 py-3">Oluşturan</th>
                <th className="px-4 py-3">Tarih</th>
                {canDeleteQuote ? <th className="px-4 py-3 w-12" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {quotes.length === 0 ? (
                <tr>
                  <td colSpan={canDeleteQuote ? 9 : 8} className="px-4 py-16 text-center text-gray-400">
                    {loading ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin text-whatsapp" />
                        Yükleniyor…
                      </span>
                    ) : (
                      'Henüz teklif yok'
                    )}
                  </td>
                </tr>
              ) : (
                quotes.map((q) => (
                  <tr
                    key={q.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/quotes/${q.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(`/quotes/${q.id}`);
                      }
                    }}
                    className="hover:bg-green-50/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono font-medium text-gray-900">
                      {formatQuoteNo(q.quoteNumber)}
                      <PanelEditedBadge at={q.panelEditedAt} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{contactDisplayName(q)}</div>
                      <div className="text-xs text-gray-500">{formatPhone(q.contact.phone)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold ring-1 ring-inset ${statusBadgeClass(q.status)}`}
                      >
                        {STATUS_LABELS[q.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-medium">{q.currency}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                      {formatMoney(q.grandTotal, q.currency)}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">
                      {formatShortDate(q.validUntil)}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[120px] truncate" title={q.createdBy?.name || ''}>
                      {q.createdBy?.name || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {new Date(q.createdAt).toLocaleDateString('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </td>
                    {canDeleteQuote ? (
                      <td className="px-4 py-3 text-right">
                        {q.status === 'DRAFT' && !q.order ? (
                          <button
                            type="button"
                            onClick={(e) => void deleteQuote(q, e)}
                            className="p-2 rounded-lg text-red-600 hover:bg-red-50"
                            aria-label="Sil"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-xs text-gray-500">
              Toplam <span className="font-semibold text-gray-800">{total}</span> kayıt — Sayfa{' '}
              <span className="font-semibold text-gray-800">{page}</span> / {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => goPage(page - 1)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
              >
                <ChevronLeft className="w-4 h-4" />
                Önceki
              </button>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => goPage(page + 1)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
              >
                Sonraki
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
