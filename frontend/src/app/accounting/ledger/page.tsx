'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import { ArrowLeftRight, Loader2, Plus } from 'lucide-react';
import { backendPublicUrl } from '@/lib/utils';

type Kind = 'RECEIVABLE' | 'PAYABLE';

interface Row {
  id: string;
  kind: Kind;
  title: string;
  amount: number;
  currency: string;
  dueDate?: string | null;
  notes?: string | null;
  pdfUrl?: string | null;
  createdAt: string;
  contact?: { name?: string | null; phone?: string } | null;
  user?: { name: string };
}

export default function LedgerPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState<Kind>('RECEIVABLE');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('TRY');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/accounting/ledger-entries', { params: { limit: 100 } });
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
    if (!title.trim() || Number.isNaN(n)) {
      toast.error('Başlık ve tutar gerekli');
      return;
    }
    setSaving(true);
    try {
      await api.post('/accounting/ledger-entries', {
        kind,
        title: title.trim(),
        amount: n,
        currency,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        notes: notes.trim() || null,
      });
      toast.success('Kayıt eklendi');
      setTitle('');
      setAmount('');
      setNotes('');
      setDueDate('');
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
          <ArrowLeftRight className="w-8 h-8 text-whatsapp" />
          Gelen / Giden
        </h1>
        <p className="text-sm text-gray-500 mt-1">Basit cari kayıtları (alacak / borç).</p>
      </div>

      <form
        onSubmit={submit}
        className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <div>
          <label className="text-xs text-gray-500 block mb-1">Tür</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
          >
            <option value="RECEIVABLE">Alacak (gelen)</option>
            <option value="PAYABLE">Borç (giden)</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Para birimi</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
          >
            <option value="TRY">TRY</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Vade (opsiyonel)</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-gray-500 block mb-1">Başlık</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            placeholder="Örn. ABC Ltd. fatura bakiyesi"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Tutar</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            placeholder="0,00"
          />
        </div>
        <div className="md:col-span-2 lg:col-span-3">
          <label className="text-xs text-gray-500 block mb-1">Not</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-y"
          />
        </div>
        <div className="md:col-span-2 lg:col-span-3">
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
                  <th className="text-left px-4 py-3">Tür</th>
                  <th className="text-left px-4 py-3">Başlık</th>
                  <th className="text-right px-4 py-3">Tutar</th>
                  <th className="text-left px-4 py-3">Kişi</th>
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
                      <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">
                        {new Date(r.createdAt).toLocaleString('tr-TR')}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.kind === 'RECEIVABLE' ? (
                          <span className="text-green-700 font-medium text-xs">Alacak</span>
                        ) : (
                          <span className="text-orange-700 font-medium text-xs">Borç</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 max-w-[200px]">
                        <p className="font-medium truncate">{r.title}</p>
                        {r.notes && <p className="text-xs text-gray-400 truncate">{r.notes}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {r.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {r.currency}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">
                        {r.contact ? [r.contact.name, r.contact.phone].filter(Boolean).join(' · ') : '—'}
                      </td>
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
