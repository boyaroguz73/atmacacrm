'use client';

/** Sadece yönetim panelinde; PDF veya müşteri çıktılarında kullanılmaz */
export default function PanelEditedBadge({ at }: { at?: string | null }) {
  if (!at) return null;
  return (
    <span className="ml-1.5 text-xs font-medium text-amber-700 whitespace-nowrap" title="Kayıt panelden güncellendi">
      (düzenlendi)
    </span>
  );
}
