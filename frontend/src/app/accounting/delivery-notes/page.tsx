'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { CalendarRange, Loader2, Package, Plus, Upload } from 'lucide-react';
import { backendPublicUrl } from '@/lib/utils';

interface Row {
  id: string;
  noteNumber: number;
  shippedAt: string;
  notes?: string | null;
  pdfUrl?: string | null;
  order?: {
    orderNumber: number;
    shippingAddress?: string | null;
    contact?: { name?: string | null; phone?: string };
  };
}

export default function DeliveryNotesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [notes, setNotes] = useState('');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/accounting/delivery-notes', { params: { limit: 100 } });
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
    if (!orderId.trim()) {
      toast.error('Sipariş ID gerekli');
      return;
    }
    setSaving(true);
    try {
      await api.post('/accounting/delivery-notes', {
        orderId: orderId.trim(),
        notes: notes.trim() || null,
      });
      toast.success('İrsaliye oluşturuldu');
      setOrderId('');
      setNotes('');
      void load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'İrsaliye oluşturulamadı'));
    } finally {
      setSaving(false);
    }
  };

  const uploadPdf = async (id: string, file: File) => {
    setUploadingId(id);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/accounting/delivery-notes/${id}/upload-pdf`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('PDF yüklendi');
      void load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Yükleme başarısız'));
    } finally {
      setUploadingId(null);
    }
  };

  const base = backendPublicUrl();
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null;
    return rows.filter((r) => {
      const shipped = new Date(r.shippedAt);
      if (from && shipped < from) return false;
      if (to && shipped > to) return false;
      if (!q) return true;
      return (
        String(r.noteNumber).includes(q) ||
        String(r.order?.orderNumber ?? '').includes(q) ||
        String(r.order?.contact?.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, dateFrom, dateTo]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Muhasebe / Lojistik</p>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Package className="w-8 h-8 text-whatsapp" />
          İrsaliyeler
        </h1>
            <p className="text-sm text-gray-500 mt-1">
              Sevk kayıtlarını tarih ve sipariş odaklı takip edin, PDF tamamlama durumunu buradan yönetin.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/accounting/invoices?tab=pending"
              className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Fatura bekleyenler
            </Link>
            <Link
              href="/orders"
              className="inline-flex items-center rounded-lg bg-whatsapp px-3 py-2 text-sm font-semibold text-white hover:bg-whatsapp/90"
            >
              Sipariş listesi
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <CalendarRange className="w-4 h-4 text-gray-500" />
          <p className="text-sm font-semibold text-gray-800">Filtreler</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Ara (irsaliye/sipariş/müşteri)</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
              placeholder="IRS no, sipariş no veya müşteri"
            />
          </div>
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
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              const from = new Date();
              from.setDate(from.getDate() - 30);
              setDateTo(d.toISOString().slice(0, 10));
              setDateFrom(from.toISOString().slice(0, 10));
              setSearch('');
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 self-end"
          >
            Son 30 gün
          </button>
        </div>
      </div>

      <form
        onSubmit={submit}
        className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col sm:flex-row gap-4 items-end flex-wrap"
      >
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-gray-500 block mb-1">Sipariş ID</label>
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono"
            placeholder="uuid…"
          />
        </div>
        <div className="flex-[2] min-w-[220px]">
          <label className="text-xs text-gray-500 block mb-1">Not (opsiyonel)</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            placeholder="Sevk notu"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Oluştur
        </button>
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
                  <th className="text-left px-4 py-3">No</th>
                  <th className="text-left px-4 py-3">Tarih</th>
                  <th className="text-left px-4 py-3">Sipariş</th>
                  <th className="text-left px-4 py-3">Alıcı</th>
                  <th className="text-left px-4 py-3">PDF</th>
                  <th className="text-left px-4 py-3">Yükle</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      Filtreye uyan irsaliye yok
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => (
                    <tr key={r.id} className="border-t border-gray-50">
                      <td className="px-4 py-2.5 font-mono text-xs">IRS-{String(r.noteNumber).padStart(5, '0')}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {new Date(r.shippedAt).toLocaleString('tr-TR')}
                      </td>
                      <td className="px-4 py-2.5">
                        #{r.order?.orderNumber}
                        {r.order?.shippingAddress && (
                          <p className="text-xs text-gray-400 truncate max-w-[200px]">{r.order.shippingAddress}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">
                        {r.order?.contact
                          ? [r.order.contact.name, r.order.contact.phone].filter(Boolean).join(' · ')
                          : '—'}
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
                      <td className="px-4 py-2.5">
                        <label className="inline-flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          <span>PDF</span>
                          <input
                            type="file"
                            accept=".pdf"
                            className="hidden"
                            disabled={uploadingId === r.id}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = '';
                              if (f) void uploadPdf(r.id, f);
                            }}
                          />
                        </label>
                        {uploadingId === r.id && <Loader2 className="w-4 h-4 animate-spin inline ml-1" />}
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
