import { BadRequestException } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';

const ORDER: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.INTERESTED,
  LeadStatus.OFFER_SENT,
  LeadStatus.WON,
  LeadStatus.LOST,
];

function orderIndex(s: LeadStatus): number {
  const i = ORDER.indexOf(s);
  return i < 0 ? 0 : i;
}

/**
 * İzin verilen geçişler: aynı aşamaya izin yok; geri adım yok (WON/LOST hariç yeniden açılış);
 * LOST için lossReason zorunlu (HTTP); otomasyon için isteğe bağlı.
 */
export function assertLeadStatusTransition(
  from: LeadStatus,
  to: LeadStatus,
  opts?: { lossReason?: string | null; requireLossReason?: boolean },
): void {
  if (from === to) {
    throw new BadRequestException('Lead zaten bu durumda');
  }
  if (to === LeadStatus.LOST) {
    const need = opts?.requireLossReason !== false;
    const r = (opts?.lossReason ?? '').trim();
    if (need && r.length < 2) {
      throw new BadRequestException('Kaybedildi durumu için kayıp nedeni girin (en az 2 karakter)');
    }
  }
  const closed = from === LeadStatus.WON || from === LeadStatus.LOST;
  if (closed) {
    const reopen = to === LeadStatus.NEW || to === LeadStatus.CONTACTED;
    if (!reopen) {
      throw new BadRequestException('Kapanmış lead yalnızca Yeni veya İletişim Kuruldu ile yeniden açılabilir');
    }
    return;
  }
  const fi = orderIndex(from);
  const ti = orderIndex(to);
  if (to === LeadStatus.LOST || to === LeadStatus.WON) return;
  if (ti < fi) {
    throw new BadRequestException('Lead durumu geri alınamaz (Kapatılmış kayıt hariç)');
  }
}
