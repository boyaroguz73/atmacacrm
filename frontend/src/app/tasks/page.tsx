'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPhone } from '@/lib/utils';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  X,
  Plus,
  CalendarClock,
  User,
  Phone,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DateRangePicker from '@/components/ui/DateRangePicker';

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  dueAt: string;
  trigger: string | null;
  createdAt: string;
  completedAt: string | null;
  contact: { id: string; name: string | null; phone: string } | null;
  user?: { id: string; name: string };
}

interface TaskStats {
  pending: number;
  overdue: number;
  completedToday: number;
}

export default function TasksPage() {
  const { user } = useAuthStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<TaskStats>({ pending: 0, overdue: 0, completedToday: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('PENDING');
  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', dueAt: '' });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';

  const fetchTasks = async () => {
    try {
      const endpoint = isAdmin ? '/tasks/all' : '/tasks/my';
      const statsEndpoint = isAdmin ? '/tasks/all/stats' : '/tasks/my/stats';
      const params: any = {};
      if (filter) params.status = filter;
      if (dateFrom) params.from = dateFrom + 'T00:00:00';
      if (dateTo) params.to = dateTo + 'T23:59:59';

      const [tasksRes, statsRes] = await Promise.all([
        api.get(endpoint, { params }),
        api.get(statsEndpoint),
      ]);

      setTasks(tasksRes.data.tasks || []);
      setStats(statsRes.data);
    } catch (error) {
      console.error(error);
      toast.error('Veriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) fetchTasks();
  }, [filter, dateFrom, dateTo, user?.role]);

  const completeTask = async (id: string) => {
    try {
      await api.patch(`/tasks/${id}/complete`);
      toast.success('Görev tamamlandı');
      fetchTasks();
    } catch {
      toast.error('İşlem başarısız');
    }
  };

  const cancelTask = async (id: string) => {
    try {
      await api.patch(`/tasks/${id}/cancel`);
      toast.success('Görev iptal edildi');
      fetchTasks();
    } catch {
      toast.error('İşlem başarısız');
    }
  };

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title || !newTask.dueAt) return;
    try {
      await api.post('/tasks', {
        title: newTask.title,
        description: newTask.description || undefined,
        dueAt: new Date(newTask.dueAt).toISOString(),
      });
      toast.success('Görev oluşturuldu');
      setNewTask({ title: '', description: '', dueAt: '' });
      setShowForm(false);
      fetchTasks();
    } catch {
      toast.error('Görev oluşturulamadı');
    }
  };

  const isOverdue = (dueAt: string) => new Date(dueAt) < new Date();

  const formatDue = (dueAt: string) => {
    const d = new Date(dueAt);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    const hours = Math.floor(Math.abs(diff) / (1000 * 60 * 60));
    const minutes = Math.floor((Math.abs(diff) % (1000 * 60 * 60)) / (1000 * 60));

    if (diff < 0) {
      if (hours > 24) return `${Math.floor(hours / 24)} gün gecikmiş`;
      if (hours > 0) return `${hours} saat gecikmiş`;
      return `${minutes} dk gecikmiş`;
    }
    if (hours > 24) return `${Math.floor(hours / 24)} gün kaldı`;
    if (hours > 0) return `${hours} saat kaldı`;
    return `${minutes} dk kaldı`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-whatsapp border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Görevler</h1>
          <p className="text-gray-500 text-sm mt-1">Hatırlatıcılar ve takip görevleri</p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onChange={(f, t) => {
              setDateFrom(f);
              setDateTo(t);
            }}
          />
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 bg-whatsapp text-white rounded-xl text-sm font-medium hover:bg-green-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Yeni Görev
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-yellow-500" />
            <span className="text-xs text-gray-500 font-medium">Bekleyen</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.pending}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-xs text-gray-500 font-medium">Gecikmiş</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{stats.overdue}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-xs text-gray-500 font-medium">Bugün Tamamlanan</span>
          </div>
          <p className="text-2xl font-bold text-green-600">{stats.completedToday}</p>
        </div>
      </div>

      {/* New Task Form */}
      {showForm && (
        <form onSubmit={createTask} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm space-y-3">
          <input
            type="text"
            placeholder="Görev başlığı"
            value={newTask.title}
            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp"
            required
          />
          <input
            type="text"
            placeholder="Açıklama (opsiyonel)"
            value={newTask.description}
            onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp"
          />
          <div className="flex gap-3">
            <input
              type="datetime-local"
              value={newTask.dueAt}
              onChange={(e) => setNewTask({ ...newTask, dueAt: e.target.value })}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp"
              required
            />
            <button type="submit" className="px-5 py-2.5 bg-whatsapp text-white rounded-xl text-sm font-medium hover:bg-green-600">
              Oluştur
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        {[
          { key: 'PENDING', label: 'Bekleyen' },
          { key: 'COMPLETED', label: 'Tamamlanan' },
          { key: 'CANCELLED', label: 'İptal' },
          { key: '', label: 'Tümü' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f.key
                ? 'bg-whatsapp text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Tasks List */}
      <div className="space-y-2">
        {tasks.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
            <CalendarClock className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Görev bulunamadı</p>
          </div>
        ) : (
          tasks.map((task) => {
            const overdue = task.status === 'PENDING' && isOverdue(task.dueAt);
            return (
              <div
                key={task.id}
                className={`bg-white rounded-xl border p-4 shadow-sm flex items-start gap-4 ${
                  overdue
                    ? 'border-red-200 bg-red-50/30'
                    : task.status === 'COMPLETED'
                      ? 'border-green-200 bg-green-50/30'
                      : 'border-gray-100'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className={`font-semibold text-sm ${task.status === 'COMPLETED' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                      {task.title}
                    </h3>
                    {task.trigger && (
                      <span className="text-[10px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">
                        {task.trigger}
                      </span>
                    )}
                  </div>
                  {task.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    {task.contact && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Phone className="w-3 h-3" />
                        {task.contact.name || formatPhone(task.contact.phone)}
                      </span>
                    )}
                    {task.user && isAdmin && (
                      <span className="flex items-center gap-1 text-xs text-blue-600">
                        <User className="w-3 h-3" />
                        {task.user.name}
                      </span>
                    )}
                    <span className={`flex items-center gap-1 text-xs ${overdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                      <Clock className="w-3 h-3" />
                      {formatDue(task.dueAt)}
                    </span>
                    <span className="text-[10px] text-gray-300">
                      {new Date(task.dueAt).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    </span>
                  </div>
                </div>

                {task.status === 'PENDING' && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => completeTask(task.id)} className="p-1.5 text-green-500 hover:bg-green-50 rounded-lg" title="Tamamla">
                      <CheckCircle2 className="w-5 h-5" />
                    </button>
                    <button onClick={() => cancelTask(task.id)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg" title="İptal">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
