'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { Banknote, CalendarRange, Loader2, Plus } from 'lucide-react';
import { backendPublicUrl } from '@/lib/utils';

type Direction = 'INCOME' | 'EXPENSE';

interface Row {
  id: string;
  amount: number;
  direction: Direction;
  description: string;
  occurredAt: string;
  pdfUrl?: string | null;
  order?: { orderNumber: number } | null;
  invoice?: { invoiceNumber: number } | null;
  user?: { name: string };
}

export default function CashBookPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<Direction>('INCOME');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [directionFilter, setDirectionFilter] = useState<'ALL' | Direction>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/accounting/cash-entries', { params: { limit: 100 } });
      setRows(data.items || []);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Liste yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = parseFloat(amount.replace(',', '.'));
    if (!description.trim() || Number.isNaN(n)) {
      toast.error('Tutar ve açıklama gerekli');
      return;
    }
    setSaving(true);
    try {
      await api.post('/accounting/cash-entries', {
        amount: n,
        direction,
        description: description.trim(),
        occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
      });
      toast.success('Kayıt eklendi');
      setAmount('');
      setDescription('');
      void load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kayıt eklenemedi'));
    } finally {
      setSaving(false);
    }
  };

  const base = backendPublicUrl();
  const filteredRows = useMemo(() => {
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null;
    return rows.filter((r) => {
      if (directionFilter !== 'ALL' && r.direction !== directionFilter) return false;
      const at = new Date(r.occurredAt);
      if (from && at < from) return false;
      if (to && at > to) return false;
      return true;
    });
  }, [rows, dateFrom, dateTo, directionFilter]);

  const totals = useMemo(() => {
    const income = filteredRows
      .filter((r) => r.direction === 'INCOME')
      .reduce((sum, r) => sum + (Number.isFinite(r.amount) ? r.amount : 0), 0);
    const expense = filteredRows
      .filter((r) => r.direction === 'EXPENSE')
      .reduce((sum, r) => sum + (Number.isFinite(r.amount) ? r.amount : 0), 0);
    return { income, expense, net: income - expense };
  }, [filteredRows]);

  const fmt = (n: number) =>
    n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Muhasebe / Nakit</p>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Banknote className="w-8 h-8 text-whatsapp" />
          Kasa defteri
        </h1>
            <p className="text-sm text-gray-500 mt-1">
              Gelir-gider hareketlerini tarih aralığına göre izleyin, hızlıca tahsilat akışına dönün.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/accounting/ledger"
              className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cari deftere git
            </Link>
            <Link
              href="/accounting/invoices?tab=pending"
              className="inline-flex items-center rounded-lg bg-whatsapp px-3 py-2 text-sm font-semibold text-white hover:bg-whatsapp/90"
            >
              Fatura bekleyenler
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 shadow-sm">
          <p className="text-xs font-semibold text-emerald-900 uppercase tracking-wide">Gelir</p>
          <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{fmt(totals.income)} TL</p>
          <p className="text-xs text-emerald-900/80 mt-1">Seçili tarih aralığı</p>
        </div>
        <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-4 shadow-sm">
          <p className="text-xs font-semibold text-rose-900 uppercase tracking-wide">Gider</p>
          <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{fmt(totals.expense)} TL</p>
          <p className="text-xs text-rose-900/80 mt-1">Seçili tarih aralığı</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Net nakit</p>
          <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{fmt(totals.net)} TL</p>
          <p className="text-xs text-gray-500 mt-1">Filtreye uyan {filteredRows.length} hareket</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <CalendarRange className="w-4 h-4 text-gray-500" />
          <p className="text-sm font-semibold text-gray-800">Filtreler</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Başlangıç</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Bitiş</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Yön</label>
            <select
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value as 'ALL' | Direction)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            >
              <option value="ALL">Tümü</option>
              <option value="INCOME">Gelir</option>
              <option value="EXPENSE">Gider</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                const d = new Date();
                const from = new Date();
                from.setDate(from.getDate() - 30);
                setDateTo(d.toISOString().slice(0, 10));
                setDateFrom(from.toISOString().slice(0, 10));
                setDirectionFilter('ALL');
              }}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Son 30 gün
            </button>
          </div>
        </div>
      </div>

      <form
        onSubmit={submit}
        className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end"
      >
        <div>
          <label className="text-xs text-gray-500 block mb-1">Tutar</label>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            placeholder="0,00"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Yön</label>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
          >
            <option value="INCOME">Gelir</option>
            <option value="EXPENSE">Gider</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Tarih</label>
          <input
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
          />
        </div>
        <div className="md:col-span-2 lg:col-span-4">
          <label className="text-xs text-gray-500 block mb-1">Açıklama</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            placeholder="Örn. Nakit tahsilat — sipariş #12"
          />
        </div>
        <div className="md:col-span-2 lg:col-span-4">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Kaydet
          </button>
        </div>
      </form>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-whatsapp" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Tarih</th>
                  <th className="text-left px-4 py-3">Yön</th>
                  <th className="text-right px-4 py-3">Tutar</th>
                  <th className="text-left px-4 py-3">Açıklama</th>
                  <th className="text-left px-4 py-3">Kayıt</th>
                  <th className="text-left px-4 py-3">PDF</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      Filtreye uyan kayıt yok
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => (
                    <tr key={r.id} className="border-t border-gray-50">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {new Date(r.occurredAt).toLocaleString('tr-TR')}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={
                            r.direction === 'INCOME'
                              ? 'text-green-600 font-medium'
                              : 'text-red-600 font-medium'
                          }
                        >
                          {r.direction === 'INCOME' ? 'Gelir' : 'Gider'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {r.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2.5 max-w-xs truncate" title={r.description}>
                        {r.description}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{r.user?.name}</td>
                      <td className="px-4 py-2.5">
                        {r.pdfUrl ? (
                          <a
                            href={`${base}${r.pdfUrl}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-whatsapp text-xs font-medium hover:underline"
                          >
                            Aç
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
