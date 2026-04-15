'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import { Banknote, Loader2, Plus } from 'lucide-react';
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Banknote className="w-8 h-8 text-whatsapp" />
          Kasa defteri
        </h1>
        <p className="text-sm text-gray-500 mt-1">Manuel gelir / gider kayıtları; isteğe bağlı PDF bağlantısı.</p>
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
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      Henüz kayıt yok
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
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
