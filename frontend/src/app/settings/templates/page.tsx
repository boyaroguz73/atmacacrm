'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import {
  ArrowLeft,
  Plus,
  Edit2,
  Trash2,
  FileText,
  Search,
  ToggleLeft,
  ToggleRight,
  Copy,
  Tag,
  Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Template {
  id: string;
  title: string;
  body: string;
  category: string | null;
  shortcut: string | null;
  isActive: boolean;
  createdAt: string;
  creator: { id: string; name: string };
}

type TemplateVariable = {
  token: string;
  label: string;
  description: string;
  sample: string;
};

const TEMPLATE_VARIABLES: TemplateVariable[] = [
  {
    token: '{isim}',
    label: 'Müşteri adı',
    description: 'Kişinin ad/soyad bilgisi ile doldurulur.',
    sample: 'Ahmet Yılmaz',
  },
  {
    token: '{telefon}',
    label: 'Müşteri telefonu',
    description: 'Kişinin kayıtlı telefon numarası ile doldurulur.',
    sample: '+90 555 123 45 67',
  },
];

function renderPreview(templateBody: string): string {
  let out = templateBody || '';
  for (const v of TEMPLATE_VARIABLES) {
    out = out.split(v.token).join(v.sample);
  }
  return out;
}

export function TemplatesManager({ embedded = false }: { embedded?: boolean }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState<string[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [form, setForm] = useState({ title: '', body: '', category: '', shortcut: '' });

  useEffect(() => {
    void fetchTemplates();
    void fetchCategories();
  }, []);

  const fetchTemplates = async () => {
    try {
      const { data } = await api.get('/templates');
      setTemplates(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Şablonlar yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const { data } = await api.get('/templates/categories');
      setCategories(Array.isArray(data) ? data : []);
    } catch {
      setCategories([]);
    }
  };

  const handleSave = async () => {
    try {
      const payload: Record<string, string> = {
        title: form.title.trim(),
        body: form.body.trim(),
      };
      if (form.category.trim()) payload.category = form.category.trim();
      if (form.shortcut.trim()) payload.shortcut = form.shortcut.trim();

      if (editingTemplate) {
        await api.patch(`/templates/${editingTemplate.id}`, payload);
        toast.success('Şablon güncellendi');
      } else {
        await api.post('/templates', payload);
        toast.success('Şablon oluşturuldu');
      }
      setShowModal(false);
      setEditingTemplate(null);
      setForm({ title: '', body: '', category: '', shortcut: '' });
      await fetchTemplates();
      await fetchCategories();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Şablon kaydedilemedi');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bu şablonu silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/templates/${id}`);
      toast.success('Şablon silindi');
      await fetchTemplates();
    } catch {
      toast.error('Şablon silinemedi');
    }
  };

  const handleToggle = async (template: Template) => {
    try {
      await api.patch(`/templates/${template.id}`, { isActive: !template.isActive });
      await fetchTemplates();
    } catch {
      toast.error('Durum güncellenemedi');
    }
  };

  const openEdit = (t: Template) => {
    setEditingTemplate(t);
    setForm({
      title: t.title,
      body: t.body,
      category: t.category || '',
      shortcut: t.shortcut || '',
    });
    setShowModal(true);
  };

  const openNew = () => {
    setEditingTemplate(null);
    setForm({ title: '', body: '', category: '', shortcut: '' });
    setShowModal(true);
  };

  const insertVariable = (token: string) => {
    setForm((prev) => ({ ...prev, body: `${prev.body}${prev.body ? ' ' : ''}${token}` }));
  };

  const filtered = useMemo(() => {
    return templates.filter((t) => {
      const q = search.toLowerCase().trim();
      const matchSearch =
        !q ||
        t.title.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        (t.shortcut || '').toLowerCase().includes(q);
      const matchCat = !categoryFilter || t.category === categoryFilter;
      return matchSearch && matchCat;
    });
  }, [templates, search, categoryFilter]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {!embedded ? (
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Ayarlar
          </Link>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mesaj Şablonları</h1>
          <p className="text-sm text-gray-500 mt-1">
            Şablon metinlerini tek yerden yönetin, kullanılabilir değişkenleri görerek daha hızlı oluşturun.
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-whatsapp text-white rounded-lg hover:bg-green-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Yeni Şablon
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <p className="text-sm font-semibold text-gray-900">Kullanılabilir Değişkenler</p>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {TEMPLATE_VARIABLES.map((v) => (
            <div key={v.token} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-gray-800">{v.token} · {v.label}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{v.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Başlık, içerik veya kısayol ara..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
        >
          <option value="">Tüm Kategoriler</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-whatsapp border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Henüz şablon bulunamadı</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((t) => (
            <div
              key={t.id}
              className={`bg-white border rounded-xl p-4 hover:shadow-sm transition-shadow ${!t.isActive ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{t.title}</h3>
                    {t.category && (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                        <Tag className="w-3 h-3" />
                        {t.category}
                      </span>
                    )}
                    {t.shortcut && (
                      <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">
                        /{t.shortcut}
                      </span>
                    )}
                    {!t.isActive && (
                      <span className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
                        Pasif
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-3">{t.body}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    Oluşturan: {t.creator.name} · {new Date(t.createdAt).toLocaleDateString('tr-TR')}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-3">
                  <button
                    onClick={() => handleToggle(t)}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title={t.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                  >
                    {t.isActive ? (
                      <ToggleRight className="w-5 h-5 text-green-500" />
                    ) : (
                      <ToggleLeft className="w-5 h-5" />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(t.body);
                      toast.success('Şablon metni kopyalandı');
                    }}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
                    title="Kopyala"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openEdit(t)}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Düzenle"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Sil"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl shadow-xl">
            <div className="p-5 border-b">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingTemplate ? 'Şablonu Düzenle' : 'Yeni Şablon'}
              </h2>
            </div>
            <div className="p-5 grid md:grid-cols-2 gap-5">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Başlık *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Örn: Hoş geldiniz mesajı"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mesaj içeriği *</label>
                  <textarea
                    value={form.body}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                    rows={7}
                    placeholder="Mesaj metnini yazın..."
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20 resize-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Kategori</label>
                    <input
                      type="text"
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      placeholder="Örn: Karşılama"
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
                      list="template-category-list"
                    />
                    <datalist id="template-category-list">
                      {categories.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Kısayol</label>
                    <div className="flex items-center">
                      <span className="text-gray-400 text-sm mr-1">/</span>
                      <input
                        type="text"
                        value={form.shortcut}
                        onChange={(e) =>
                          setForm({ ...form, shortcut: e.target.value.replace(/\s/g, '') })
                        }
                        placeholder="hosgeldin"
                        className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs font-semibold text-gray-800 mb-2">Değişken Ekle</p>
                  <div className="flex flex-wrap gap-2">
                    {TEMPLATE_VARIABLES.map((v) => (
                      <button
                        key={v.token}
                        type="button"
                        onClick={() => insertVariable(v.token)}
                        className="px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-gray-200 hover:border-whatsapp/40 hover:text-whatsapp"
                        title={v.description}
                      >
                        {v.token}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <p className="text-xs font-semibold text-gray-800 mb-2">Önizleme</p>
                  <div className="text-sm text-gray-700 whitespace-pre-wrap min-h-[120px]">
                    {renderPreview(form.body) || 'Önizleme için mesaj içeriği girin.'}
                  </div>
                </div>
              </div>
            </div>
            <div className="p-5 border-t flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingTemplate(null);
                }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg text-sm"
              >
                İptal
              </button>
              <button
                onClick={handleSave}
                disabled={!form.title.trim() || !form.body.trim()}
                className="px-4 py-2 bg-whatsapp text-white rounded-lg text-sm hover:bg-green-600 disabled:opacity-50 transition-colors"
              >
                {editingTemplate ? 'Güncelle' : 'Oluştur'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsTemplatesPage() {
  return <TemplatesManager />;
}

