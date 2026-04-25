'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  CalendarDays,
  Plus,
} from 'lucide-react';

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  dueAt: string;
  createdAt: string;
  user?: { id: string; name: string };
  contact?: { id: string; name: string; phone: string } | null;
}

const DAYS_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTHS_TR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function isSameDay(d1: Date, d2: Date) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function dueRemainingText(dueAt: string) {
  const due = new Date(dueAt);
  const diff = due.getTime() - Date.now();
  const absHours = Math.floor(Math.abs(diff) / (1000 * 60 * 60));
  const absMinutes = Math.floor((Math.abs(diff) % (1000 * 60 * 60)) / (1000 * 60));
  if (diff < 0) {
    if (absHours >= 24) return `${Math.floor(absHours / 24)} gun gecikmis`;
    if (absHours > 0) return `${absHours} saat gecikmis`;
    return `${absMinutes} dk gecikmis`;
  }
  if (absHours >= 24) return `${Math.floor(absHours / 24)} gun kaldi`;
  if (absHours > 0) return `${absHours} saat kaldi`;
  return `${absMinutes} dk kaldi`;
}

function getCalendarDays(year: number, month: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  let startDay = first.getDay() - 1;
  if (startDay < 0) startDay = 6;

  const days: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

const statusConfig = {
  PENDING: { icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200', dot: 'bg-yellow-400', label: 'Bekliyor' },
  COMPLETED: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50 border-green-200', dot: 'bg-green-400', label: 'Tamamlandı' },
  CANCELLED: { icon: XCircle, color: 'text-gray-400', bg: 'bg-gray-50 border-gray-200', dot: 'bg-gray-300', label: 'İptal' },
};

export default function CalendarPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [userRole, setUserRole] = useState('AGENT');

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = getCalendarDays(year, month);
  const today = new Date();

  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u.role) setUserRole(u.role);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [currentDate, userRole]);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const from = new Date(year, month, 1).toISOString().split('T')[0] + 'T00:00:00';
      const to = new Date(year, month + 1, 0).toISOString().split('T')[0] + 'T23:59:59';
      const isAdmin = userRole === 'ADMIN' || userRole === 'SUPERADMIN';
      const endpoint = isAdmin ? '/tasks/all' : '/tasks/my';
      const { data } = await api.get(endpoint, { params: { from, to } });
      setTasks(data.tasks || data || []);
    } catch {
      setTasks([]);
      toast.error('Görevler yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  };

  const getTasksForDay = (date: Date) =>
    tasks.filter((t) => isSameDay(new Date(t.dueAt), date));

  const selectedTasks = selectedDate ? getTasksForDay(selectedDate) : [];
  const todayTasks = getTasksForDay(today);

  const overduePending = tasks.filter(
    (t) => t.status === 'PENDING' && new Date(t.dueAt) < today,
  );

  const stats = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'PENDING').length,
    completed: tasks.filter((t) => t.status === 'COMPLETED').length,
    overdue: overduePending.length,
  };

  const handleComplete = async (taskId: string) => {
    try {
      await api.patch(`/tasks/${taskId}/complete`);
      fetchTasks();
    } catch {}
  };

  const tasksCreateHref = (date?: Date) => {
    const d = date || selectedDate || new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `/tasks?new=1&date=${yyyy}-${mm}-${dd}`;
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full max-w-none">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Takvim</h1>
          <p className="text-gray-500 text-sm mt-1">
            Görev ve takip tarihlerini takvim üzerinde görüntüleyin
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={goToday}
            className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Bugün
          </button>
          <Link
            href={tasksCreateHref()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-whatsapp text-white rounded-lg hover:bg-green-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Görev Ekle
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-whatsapp/20 bg-whatsapp/5 px-4 py-2.5">
        <p className="text-sm font-medium text-gray-800">
          Bugun: <span className="font-bold text-whatsapp">{todayTasks.length} gorev var</span>
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: 'Toplam Görev', value: stats.total, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Bekleyen', value: stats.pending, color: 'text-yellow-600', bg: 'bg-yellow-50' },
          { label: 'Tamamlanan', value: stats.completed, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Geciken', value: stats.overdue, color: 'text-red-600', bg: 'bg-red-50' },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} rounded-xl p-4 border border-gray-200 min-h-[92px]`}>
            <p className="text-xs text-gray-500 font-medium">{s.label}</p>
            <p className={`text-3xl font-extrabold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col xl:flex-row gap-4 xl:gap-6">
        {/* Calendar Grid */}
        <div className="min-w-0 flex-1 bg-white rounded-xl border border-gray-200 shadow-sm">
          {/* Month Navigator */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <button onClick={prevMonth} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <h2 className="text-lg font-semibold text-gray-900">
              {MONTHS_TR[month]} {year}
            </h2>
            <button onClick={nextMonth} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>
          </div>

          {/* Day Headers */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {DAYS_TR.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-gray-400 uppercase">
                {d}
              </div>
            ))}
          </div>

          {/* Day Cells */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-whatsapp border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-7">
              {days.map((day, i) => {
                if (!day) {
                  return (
                    <div
                      key={`empty-${i}`}
                      className="min-h-[110px] lg:min-h-[130px] border-b border-r border-gray-50 bg-gray-50/30"
                    />
                  );
                }

                const dayTasks = getTasksForDay(day);
                const isToday = isSameDay(day, today);
                const isSelected = selectedDate && isSameDay(day, selectedDate);
                const hasOverdue = dayTasks.some((t) => t.status === 'PENDING' && new Date(t.dueAt) < today);

                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => setSelectedDate(day)}
                    className={`min-h-[110px] lg:min-h-[130px] border-b border-r border-gray-100 p-2 text-left transition-colors hover:bg-blue-50/50 ${
                      isSelected ? 'bg-blue-100/70 ring-2 ring-blue-400 ring-inset' : isToday ? 'bg-whatsapp/5 ring-1 ring-whatsapp/20 ring-inset' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${
                          isToday
                            ? 'bg-whatsapp text-white'
                            : 'text-gray-700'
                        }`}
                      >
                        {day.getDate()}
                      </span>
                      {hasOverdue && (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                      )}
                    </div>
                    <div className="space-y-1 max-h-[70px] lg:max-h-[88px] overflow-y-auto pr-1">
                      {dayTasks.slice(0, 4).map((t) => {
                        const sc = statusConfig[t.status];
                        return (
                          <div
                            key={t.id}
                            title={t.title}
                            className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-medium bg-gray-50"
                          >
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dot}`} />
                            <span className="truncate text-gray-700 leading-tight">{t.title}</span>
                          </div>
                        );
                      })}
                      {dayTasks.length > 4 && (
                        <span className="text-[10px] text-gray-400 pl-1">
                          +{dayTasks.length - 4} gorev
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Day Detail */}
        <div className="w-full xl:w-96 shrink-0 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col min-h-[360px] xl:min-h-0">
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-whatsapp" />
                <h3 className="font-semibold text-gray-900">
                  {selectedDate
                    ? `${selectedDate.getDate()} ${MONTHS_TR[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`
                    : 'Bir gün seçin'}
                </h3>
              </div>
              {selectedDate && (
                <Link
                  href={tasksCreateHref(selectedDate)}
                  className="p-1.5 text-whatsapp hover:bg-green-50 rounded-lg transition-colors"
                  title="Bu güne görev ekle"
                >
                  <Plus className="w-4 h-4" />
                </Link>
              )}
            </div>
            {selectedDate && (
              <p className="text-xs text-gray-400 mt-1">
                {selectedTasks.length} görev
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {!selectedDate ? (
              <div className="text-center py-12 text-gray-300">
                <CalendarDays className="w-10 h-10 mx-auto mb-2" />
                <p className="text-sm">Takvimden bir gün seçin</p>
              </div>
            ) : selectedTasks.length === 0 ? (
              <div className="text-center py-12 text-gray-300">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-2" />
                <p className="text-sm">Bu gün için görev yok</p>
                <Link
                  href={tasksCreateHref(selectedDate!)}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-whatsapp text-white rounded-lg hover:bg-green-600 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Görev Ekle
                </Link>
              </div>
            ) : (
              selectedTasks.map((task) => {
                const sc = statusConfig[task.status];
                const isOverdue = task.status === 'PENDING' && new Date(task.dueAt) < today;
                const Icon = sc.icon;

                return (
                  <div
                    key={task.id}
                    className={`p-4 rounded-xl border shadow-sm hover:shadow-md transition-all ${sc.bg}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${sc.color}`} />
                        <div className="min-w-0">
                          <p className="text-base font-semibold text-gray-900 leading-tight">
                            {task.title}
                          </p>
                          {task.description && (
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                              {task.description}
                            </p>
                          )}
                          {task.contact && (
                            <div className="mt-1 flex items-center gap-2">
                              <Link
                                href={`/inbox?filter=all&contactId=${encodeURIComponent(String(task.contact.id || ''))}`}
                                className="text-[10px] text-blue-500 inline-block hover:text-blue-700 underline"
                              >
                                {task.contact.name || task.contact.phone}
                              </Link>
                              <Link
                                href={`/inbox?filter=all&contactId=${encodeURIComponent(String(task.contact.id || ''))}`}
                                className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100"
                              >
                                Mesaja git
                              </Link>
                            </div>
                          )}
                          {task.user && (
                            <p className="text-[10px] text-blue-500 mt-0.5">
                              {task.user.name}
                            </p>
                          )}
                          <p className={`text-[11px] mt-1 ${isOverdue ? 'text-red-700 font-semibold' : 'text-gray-500'}`}>
                            {dueRemainingText(task.dueAt)}
                          </p>
                        </div>
                      </div>
                      {isOverdue && (
                        <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full">
                          Gecikmiş
                        </span>
                      )}
                    </div>
                    {task.status === 'PENDING' && (
                      <button
                        onClick={() => handleComplete(task.id)}
                        className="mt-3 w-full py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      >
                        Tamamla
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
