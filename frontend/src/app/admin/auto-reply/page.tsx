'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { ChevronDown, ChevronUp, Edit2, Pause, Play, Plus, Trash2, Zap } from 'lucide-react';

interface FlowStep {
  id: string;
  type: 'send_message' | 'wait' | 'condition' | 'add_tag' | 'set_lead_status' | 'assign_agent';
  data: Record<string, any>;
}

interface Flow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  activeFrom?: string | null;
  trigger: string;
  conditions: any;
  steps: FlowStep[];
  createdAt: string;
  creator: { id: string; name: string };
}

const TRIGGERS = [
  { value: 'new_message', label: 'Her yeni mesaj' },
  { value: 'keyword', label: 'Anahtar kelime eşleşmesi' },
  { value: 'first_message', label: 'İlk mesaj (yeni kişi)' },
  { value: 'order_status', label: 'Sipariş durumu değişti' },
  { value: 'quote_status', label: 'Teklif durumu değişti' },
  { value: 'quote_converted_to_order', label: 'Teklif siparişe dönüştü' },
  { value: 'delivery_due', label: 'Teslim tarihine göre' },
];

export default function AutoReplyPage() {
  return <AutoReplyManager />;
}

function AutoReplyManager({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFlow, setExpandedFlow] = useState<string | null>(null);
  const [creatingPreset, setCreatingPreset] = useState(false);

  const fetchFlows = async () => {
    try {
      const { data } = await api.get('/auto-reply');
      setFlows(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchFlows();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Bu akışı silmek istediğinize emin misiniz?')) return;
    await api.delete(`/auto-reply/${id}`);
    await fetchFlows();
  };

  const handleToggle = async (flow: Flow) => {
    await api.patch(`/auto-reply/${flow.id}/toggle`);
    await fetchFlows();
  };

  const createCartAbandonPreset = async () => {
    setCreatingPreset(true);
    try {
      await api.post('/auto-reply/presets/cart-abandon');
      await fetchFlows();
    } finally {
      setCreatingPreset(false);
    }
  };

  return (
    <div className={embedded ? 'p-0' : 'p-6 max-w-6xl mx-auto'}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Otomasyon</h1>
          <p className="text-sm text-gray-500 mt-1">
            Otomasyonları artık detay sayfasında kolayca oluşturup düzenleyebilirsiniz.
          </p>
        </div>
        <button
          onClick={() => router.push('/admin/auto-reply/new')}
          className="flex items-center gap-2 px-4 py-2 bg-whatsapp text-white rounded-lg hover:bg-green-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Yeni Akış
        </button>
        <button
          onClick={() => void createCartAbandonPreset()}
          disabled={creatingPreset}
          className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60"
        >
          {creatingPreset ? <Zap className="w-4 h-4 animate-pulse" /> : <Zap className="w-4 h-4" />}
          Hazır Sepet Terk Otomasyonu
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-whatsapp border-t-transparent rounded-full animate-spin" />
        </div>
      ) : flows.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Zap className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Henüz otomatik yanıt akışı oluşturulmamış</p>
        </div>
      ) : (
        <div className="space-y-3">
          {flows.map((f) => {
            const isExpanded = expandedFlow === f.id;
            return (
              <div
                key={f.id}
                className={`bg-white border rounded-xl overflow-hidden transition-shadow hover:shadow-sm ${!f.isActive ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center justify-between p-4">
                  <div
                    className="flex items-center gap-3 flex-1 cursor-pointer"
                    onClick={() => setExpandedFlow(isExpanded ? null : f.id)}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${f.isActive ? 'bg-green-50' : 'bg-gray-100'}`}
                    >
                      <Zap
                        className={`w-5 h-5 ${f.isActive ? 'text-green-600' : 'text-gray-400'}`}
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{f.name}</h3>
                      <p className="text-xs text-gray-400">
                        Tetikleyici: {TRIGGERS.find((t) => t.value === f.trigger)?.label || f.trigger}
                        {' · '}
                        {(f.steps as FlowStep[])?.length || 0} adım
                        {' · '}
                        {f.creator.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void handleToggle(f)}
                      className={`p-2 rounded-lg transition-colors ${f.isActive ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-50'}`}
                      title={f.isActive ? 'Durdur' : 'Başlat'}
                    >
                      {f.isActive ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={() => router.push(`/admin/auto-reply/${f.id}`)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => void handleDelete(f.id)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setExpandedFlow(isExpanded ? null : f.id)}
                      className="p-2 text-gray-400"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t bg-gray-50">
                    {f.description && (
                      <p className="text-sm text-gray-600 py-3">{f.description}</p>
                    )}
                    <div className="text-xs text-gray-500 pt-2">
                      Akışı düzenlemek için kalem ikonuna tıklayın.
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

