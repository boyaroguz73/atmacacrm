import { Prisma } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';

export type OrgSessionScopeUser = {
  role?: string;
  organizationId?: string | null;
};

/**
 * SUPERADMIN dışındaki kullanıcılar için organizationId'yi zorunlu olarak çözer.
 * Yoksa ForbiddenException fırlatır — fail-closed.
 * SUPERADMIN için undefined döner (tüm verilere erişim).
 */
export function requireOrgId(
  user: { role?: string; organizationId?: string | null },
): string | undefined {
  if (user.role === 'SUPERADMIN') return undefined;
  if (!user.organizationId) {
    throw new ForbiddenException('Organizasyon bulunamadı, erişim reddedildi');
  }
  return user.organizationId;
}

/**
 * Multi-tenant assert: Hedef kaydın organizationId'si ile çağıranınkini karşılaştırır.
 * SUPERADMIN her kaydı görebilir. Kullanıcının org'u yoksa hep reddeder. Hedef org null ise yalnızca SUPERADMIN erişir.
 */
export function assertBelongsToOrg(
  user: { role?: string; organizationId?: string | null },
  targetOrgId: string | null | undefined,
  entityName = 'kayıt',
): void {
  if (user.role === 'SUPERADMIN') return;
  if (!user.organizationId) {
    throw new ForbiddenException('Organizasyon bulunamadı, erişim reddedildi');
  }
  if (targetOrgId !== user.organizationId) {
    throw new ForbiddenException(`Bu ${entityName} erişim yetkiniz yok`);
  }
}

const NO_MATCH: Prisma.WhatsappSessionWhereInput = {
  id: '00000000-0000-0000-0000-000000000000',
};

const NO_CONV_MATCH: Prisma.ConversationWhereInput = {
  id: '00000000-0000-0000-0000-000000000000',
};

/**
 * Kiracı kullanıcılar için konuşma sorgusu: oturum bu org’a ait veya (legacy) null-org oturum + bu org kişisi.
 * {@link assertConversationBelongsToOrg} ile aynı mantık.
 */
export function whereConversationsForOrg(
  user: OrgSessionScopeUser,
  extra?: Prisma.ConversationWhereInput,
): Prisma.ConversationWhereInput {
  if (user.role === 'SUPERADMIN') {
    return extra ?? {};
  }
  const orgId = user.organizationId;
  if (!orgId) {
    return extra ? { AND: [NO_CONV_MATCH, extra] } : NO_CONV_MATCH;
  }

  const orgScope: Prisma.ConversationWhereInput = {
    OR: [
      { session: { organizationId: orgId } },
      {
        session: { organizationId: null },
        contact: { organizationId: orgId },
      },
    ],
  };

  if (extra) {
    return { AND: [orgScope, extra] };
  }
  return orgScope;
}

/**
 * Kiracı kullanıcılar için WhatsApp oturumu sorgusu:
 * doğrudan organizationId eşleşmesi veya (legacy) yalnızca bu org kişileriyle konuşan null-org satırları.
 */
export function whereWhatsappSessionsForOrg(
  user: OrgSessionScopeUser,
  extra?: Prisma.WhatsappSessionWhereInput,
): Prisma.WhatsappSessionWhereInput {
  if (user.role === 'SUPERADMIN') {
    return extra ?? {};
  }
  const orgId = user.organizationId;
  if (!orgId) {
    return extra ? { AND: [NO_MATCH, extra] } : NO_MATCH;
  }

  const orgScope: Prisma.WhatsappSessionWhereInput = {
    OR: [
      { organizationId: orgId },
      {
        organizationId: null,
        conversations: {
          some: { contact: { organizationId: orgId } },
        },
      },
    ],
  };

  if (extra) {
    return { AND: [orgScope, extra] };
  }
  return orgScope;
}

/** Gelen kutusu (Socket.IO) için oda adları: süper admin + ilgili kiracı. */
export function inboxSocketRoomsForConversation(conversation: {
  session: { organizationId: string | null };
  contact: { organizationId: string | null };
}): string[] {
  const rooms: string[] = ['inbox:superadmin'];
  const primary =
    conversation.session.organizationId ?? conversation.contact.organizationId;
  if (primary) {
    rooms.push(`inbox:org:${primary}`);
  }
  return rooms;
}

export function assertConversationBelongsToOrg(
  conversation: {
    session: { organizationId: string | null };
    contact: { organizationId: string | null };
  },
  user: OrgSessionScopeUser,
): void {
  if (user.role === 'SUPERADMIN') return;
  if (!user.organizationId) {
    throw new ForbiddenException('Organizasyon bulunamadı');
  }
  const oid = user.organizationId;
  const s = conversation.session.organizationId;
  const c = conversation.contact.organizationId;
  if (s === oid) return;
  if (s === null && c === oid) return;
  throw new ForbiddenException('Bu görüşmeye erişim yetkiniz yok');
}
