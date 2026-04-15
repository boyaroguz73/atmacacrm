'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
import { FolderTree, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';

interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
}
interface AutoCategoryRow {
  category: string;
  count: number;
}

export default function ProductCategoriesPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';

  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [saving, setSaving] = useState(false);
  const [autoRows, setAutoRows] = useState<AutoCategoryRow[]>([]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<CategoryRow[]>('/product-categories');
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Kategoriler yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    api
      .get<AutoCategoryRow[]>('/products/categories-summary')
      .then(({ data }) => setAutoRows(Array.isArray(data) ? data : []))
      .catch(() => setAutoRows([]));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setSortOrder('0');
    setShowForm(true);
  };

  const openEdit = (c: CategoryRow) => {
    setEditing(c);
    setName(c.name);
    setDescription(c.description ?? '');
    setSortOrder(String(c.sortOrder ?? 0));
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nm = name.trim();
    if (!nm) {
      toast.error('Ad zorunlu');
      return;
    }
    const so = parseInt(sortOrder, 10);
    if (Number.isNaN(so)) {
      toast.error('Sıra sayı olmalı');
      return;
    }
    if (!isAdmin) return;
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/product-categories/${editing.id}`, {
          name: nm,
          description: description.trim() || null,
          sortOrder: so,
        });
        toast.success('Güncellendi');
      } else {
        await api.post('/product-categories', {
          name: nm,
          description: description.trim() || null,
          sortOrder: so,
        });
        toast.success('Eklendi');
      }
      closeForm();
      void fetchRows();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kayıt başarısız'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: CategoryRow) => {
    if (!isAdmin) return;
    if (!confirm(`“${c.name}” silinsin mi?`)) return;
    try {
      await api.delete(`/product-categories/${c.id}`);
      toast.success('Silindi');
      void fetchRows();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Silinemedi'));
    }
  };

  return (
    <div className="p-4 sm:p-6 pt-0">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FolderTree className="w-8 h-8 text-whatsapp" />
              Ürün kategorileri
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Panelde referans kategori listesi. Ürün kartındaki metin kategorisi ile eşleştirmek için aynı adı kullanabilirsiniz.
            </p>
          </div>
          {isAdmin ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-medium shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Yeni kategori
            </button>
          ) : null}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-whatsapp" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="px-4 py-3">Sıra</th>
                  <th className="px-4 py-3">Ad</th>
                  <th className="px-4 py-3">Açıklama</th>
                  {isAdmin ? <th className="px-4 py-3 text-right">İşlem</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y">
                {!rows.length ? (
                  <tr>
                    <td colSpan={isAdmin ? 4 : 3} className="px-4 py-12 text-center text-gray-400">
                      Kayıt yok
                    </td>
                  </tr>
                ) : (
                  rows.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-2.5 tabular-nums text-gray-600">{c.sortOrder}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-900">{c.name}</td>
                      <td className="px-4 py-2.5 text-gray-600 text-xs max-w-md truncate" title={c.description || ''}>
                        {c.description || '—'}
                      </td>
                      {isAdmin ? (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openEdit(c)}
                            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
                            aria-label="Düzenle"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(c)}
                            className="p-2 rounded-lg text-red-600 hover:bg-red-50"
                            aria-label="Sil"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50/70">
            <h2 className="text-sm font-semibold text-gray-800">XML’den otomatik kategoriler (g:product_type)</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Ürün feed senkronu sırasında oluşur; chat ürün seçicide kategori filtresi olarak kullanılır.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                <th className="px-4 py-3">Kategori</th>
                <th className="px-4 py-3 text-right">Ürün sayısı</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {!autoRows.length ? (
                <tr>
                  <td colSpan={2} className="px-4 py-10 text-center text-gray-400">
                    XML kategori bulunamadı
                  </td>
                </tr>
              ) : (
                autoRows.map((r) => (
                  <tr key={r.category} className="hover:bg-gray-50/60">
                    <td className="px-4 py-2.5 text-gray-800">{r.category}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{r.count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && isAdmin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={closeForm}>
          <div
            className="bg-white rounded-xl shadow-xl border max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">{editing ? 'Kategori düzenle' : 'Yeni kategori'}</h2>
              <button type="button" onClick={closeForm} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Ad</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border text-sm"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Açıklama</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="mt-1 w-full px-3 py-2 rounded-xl border text-sm resize-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Sıra</label>
                <input
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 rounded-xl bg-whatsapp text-white text-sm font-semibold disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Kaydet'}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
