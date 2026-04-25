import { BadRequestException } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';

/**
 * Lead durum geçişleri serbesttir (aynı duruma geçiş hariç).
 * LOST için lossReason zorunluluğu korunur (HTTP); otomasyon için isteğe bağlı.
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
}
