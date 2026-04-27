'use client';

import { useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

const PRESETS = [
  { label: 'Bugün', key: 'today' },
  { label: 'Dün', key: 'yesterday' },
  { label: 'Son 7 Gün', key: 'week' },
  { label: 'Son 30 Gün', key: 'month' },
  { label: 'Bu Ay', key: 'this_month' },
  { label: 'Tüm Zamanlar', key: 'all' },
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function localDateStr(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getPresetDates(key: string): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = localDateStr(today);

  switch (key) {
    case 'today':
      return { from: todayStr, to: todayStr };
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      const ys = localDateStr(y);
      return { from: ys, to: ys };
    }
    case 'week': {
      const w = new Date(today);
      w.setDate(w.getDate() - 7);
      return { from: localDateStr(w), to: todayStr };
    }
    case 'month': {
      const m = new Date(today);
      m.setDate(m.getDate() - 30);
      return { from: localDateStr(m), to: todayStr };
    }
    case 'this_month': {
      const fm = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: localDateStr(fm), to: todayStr };
    }
    case 'all':
      return { from: '', to: '' };
    default:
      return { from: todayStr, to: todayStr };
  }
}

export default function DateRangePicker({
  from,
  to,
  onChange,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const handlePreset = (key: string) => {
    const dates = getPresetDates(key);
    setActivePreset(key);
    onChange(dates.from, dates.to);
    setOpen(false);
  };

  const displayLabel = () => {
    if (activePreset) {
      return PRESETS.find((p) => p.key === activePreset)?.label || 'Tarih Seç';
    }
    if (!from && !to) return 'Tüm Zamanlar';
    if (from && to) {
      const fParts = from.split('-');
      const tParts = to.split('-');
      return `${fParts[2]}/${fParts[1]} - ${tParts[2]}/${tParts[1]}`;
    }
    return 'Tarih Seç';
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:border-gray-300 transition-colors"
      >
        <Calendar className="w-4 h-4 text-gray-400" />
        <span className="font-medium">{displayLabel()}</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-xl border border-gray-200 shadow-lg p-3 w-72">
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => handlePreset(p.key)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    activePreset === p.key
                      ? 'bg-whatsapp text-white'
                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="border-t border-gray-100 pt-3">
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-2">
                Özel Aralık
              </p>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setActivePreset(null);
                    onChange(e.target.value, to);
                  }}
                  className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-whatsapp"
                />
                <input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setActivePreset(null);
                    onChange(from, e.target.value);
                  }}
                  className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-whatsapp"
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
