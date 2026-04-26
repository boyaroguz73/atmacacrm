'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import { backendPublicUrl } from '@/lib/utils';
import { ArrowLeft, Search, Trash2, UploadCloud, FileText, Image as ImageIcon } from 'lucide-react';

type Kartela = {
  id: string;
  name: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

export function KartelasManager({ embedded = false }: { embedded?: boolean }) {
  const [items, setItems] = useState<Kartela[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const fetchItems = async (q?: string) => {
    try {
      const { data } = await api.get('/kartelas', { params: { search: q || undefined } });
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kartelalar alınamadı'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLocaleLowerCase('tr-TR').includes(q) ||
        i.fileName.toLocaleLowerCase('tr-TR').includes(q),
    );
  }, [items, search]);

  const onUpload = async () => {
    if (!file) {
      toast.error('Dosya seçin');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (name.trim()) fd.append('name', name.trim());
      await api.post('/kartelas/upload', fd, { timeout: 120_000 });
      setFile(null);
      setName('');
      await fetchItems(search);
      toast.success('Kartela yüklendi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kartela yüklenemedi'));
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm('Kartela silinsin mi?')) return;
    try {
      await api.delete(`/kartelas/${id}`);
      setItems((prev) => prev.filter((x) => x.id !== id));
      toast.success('Kartela silindi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kartela silinemedi'));
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {!embedded ? (
        <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" />
          Ayarlar
        </Link>
      ) : null}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Kartela Modulu</h1>
        <p className="text-sm text-gray-500 mt-1">
          Temsilciler ve yoneticiler burada kartela dosyalari olusturur, chatte secip tek tikla gonderir.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="grid md:grid-cols-[1fr_220px_auto] gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
            placeholder="Kartela adi (opsiyonel)"
          />
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <button
            type="button"
            onClick={onUpload}
            disabled={uploading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-whatsapp text-white hover:bg-green-600 disabled:opacity-60"
          >
            <UploadCloud className="w-4 h-4" />
            Yukle
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Kartela ara..."
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 py-10 text-center">Yukleniyor...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-gray-500 py-10 text-center">Kartela bulunamadi.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((item) => {
            const full = `${backendPublicUrl()}${item.fileUrl}`;
            const isPdf = String(item.mimeType || '').toLowerCase().includes('pdf');
            return (
              <div key={item.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="aspect-[4/3] bg-gray-50 border-b border-gray-100 flex items-center justify-center">
                  {isPdf ? (
                    <div className="text-gray-500 flex flex-col items-center gap-2">
                      <FileText className="w-10 h-10" />
                      <span className="text-xs">PDF</span>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={full} alt={item.name} className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900 line-clamp-2">{item.name}</p>
                    <button
                      type="button"
                      onClick={() => void onDelete(item.id)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
                      title="Sil"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{item.fileName}</p>
                  <a
                    href={full}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-whatsapp hover:underline"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    Onizle
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function KartelasPage() {
  return <KartelasManager />;
}
