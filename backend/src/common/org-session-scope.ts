import { Prisma } from '@prisma/client';

/**
 * Tek firma (single-tenant) modu.
 * Çoklu kiracı filtreleri ve org assert’leri kaldırıldı; tüm oturum/görüşme sorguları açık.
 * Veritabanında organizationId alanları kalabilir (Prisma şema), uygulama mantığı bunlara göre ayırmaz.
 */
export type OrgSessionScopeUser = {
  role?: string;
  organizationId?: string | null;
};

/** Artık zorunlu değil; JWT’de varsa döner. */
export function requireOrgId(
  user: { role?: string; organizationId?: string | null },
): string | undefined {
  return user.organizationId ?? undefined;
}

/** Tek firma: org kontrolü yok. */
export function assertBelongsToOrg(
  _user: { role?: string; organizationId?: string | null },
  _targetOrgId: string | null | undefined,
  _entityName = 'kayıt',
): void {}

export function whereConversationsForOrg(
  _user: OrgSessionScopeUser,
  extra?: Prisma.ConversationWhereInput,
): Prisma.ConversationWhereInput {
  return extra ?? {};
}

export function whereWhatsappSessionsForOrg(
  _user: OrgSessionScopeUser,
  extra?: Prisma.WhatsappSessionWhereInput,
): Prisma.WhatsappSessionWhereInput {
  return extra ?? {};
}

/** Gelen kutusu: tek oda (tüm kullanıcılar aynı yayını alır). */
export function inboxSocketRoomsForConversation(_conversation: {
  session: { organizationId: string | null };
  contact: { organizationId: string | null };
}): string[] {
  return ['inbox:all'];
}

export function assertConversationBelongsToOrg(
  _conversation: {
    session: { organizationId: string | null };
    contact: { organizationId: string | null };
  },
  _user: OrgSessionScopeUser,
): void {}
