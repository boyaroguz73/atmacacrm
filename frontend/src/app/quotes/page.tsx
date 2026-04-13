'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { formatPhone } from '@/lib/utils';
import toast from 'react-hot-toast';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Plus,
} from 'lucide-react';

type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

interface QuoteRow {
  id: string;
  quoteNumber: number;
  status: QuoteStatus;
  currency: string;
  grandTotal: number;
  createdAt: string;
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

function formatMoney(amount: number, currency: string): string {
  const cur = currency || 'TRY';
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: cur === 'TRY' || cur === 'USD' || cur === 'EUR' ? cur : 'TRY',
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${cur}`;
  }
}

export default function QuotesPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'' | QuoteStatus>('');

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: LIMIT };
      if (statusFilter) params.status = statusFilter;
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
  }, [page, statusFilter]);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const goPage = (p: number) => {
    setPage(Math.min(Math.max(1, p), totalPages));
  };

  if (loading && quotes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[40vh]">
        <Loader2 className="w-9 h-9 text-whatsapp animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
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

      <div className="flex flex-wrap gap-2">
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

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Teklif No</th>
                <th className="px-4 py-3">Kişi</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">Para Birimi</th>
                <th className="px-4 py-3 text-right">Genel Toplam</th>
                <th className="px-4 py-3">Tarih</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {quotes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-gray-400">
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
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {new Date(q.createdAt).toLocaleDateString('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </td>
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
