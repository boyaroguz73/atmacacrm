import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  OrgSessionScopeUser,
  whereConversationsForOrg,
} from '../../common/org-session-scope';

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

  async findOrCreate(contactId: string, sessionId: string) {
    return this.prisma.conversation.upsert({
      where: { contactId_sessionId: { contactId, sessionId } },
      update: {},
      create: { contactId, sessionId },
    });
  }

  /**
   * WhatsApp grubu için conversation oluştur/bul.
   * Gruplar için isGroup=true ve waGroupId alanları kullanılır.
   */
  async findOrCreateGroup(
    contactId: string,
    sessionId: string,
    waGroupId: string,
    groupName?: string,
  ) {
    // Önce waGroupId ile ara (eğer unique constraint varsa)
    const existing = await this.prisma.conversation.findFirst({
      where: {
        waGroupId: waGroupId.toLowerCase(),
        sessionId,
      },
    });

    if (existing) {
      // Grup adı değiştiyse güncelle
      if (groupName && existing.groupName !== groupName) {
        return this.prisma.conversation.update({
          where: { id: existing.id },
          data: { groupName },
        });
      }
      return existing;
    }

    // Yeni grup conversation oluştur
    return this.prisma.conversation.create({
      data: {
        contactId,
        sessionId,
        isGroup: true,
        waGroupId: waGroupId.toLowerCase(),
        groupName: groupName || 'WhatsApp Grubu',
      },
    });
  }

  async findAll(
    user: OrgSessionScopeUser,
    params: {
      sessionId?: string;
      assignedTo?: string;
      isArchived?: boolean;
      search?: string;
      filter?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const {
      sessionId,
      assignedTo,
      isArchived = false,
      search,
      filter,
      page = 1,
      limit = 500,
    } = params;

    const whereExtras: any = { isArchived };

    if (sessionId) whereExtras.sessionId = sessionId;

    if (filter === 'all') {
      // Yalnızca org kapsamı; atama filtresi yok (temsilci "tüm sohbetler")
    } else if (filter === 'mine' && assignedTo) {
      whereExtras.assignments = {
        some: { userId: assignedTo, unassignedAt: null },
      };
    } else if (filter === 'mine_and_unassigned' && assignedTo) {
      whereExtras.OR = [
        { assignments: { none: { unassignedAt: null } } },
        { assignments: { some: { userId: assignedTo, unassignedAt: null } } },
      ];
    } else if (filter === 'unassigned') {
      whereExtras.assignments = { none: { unassignedAt: null } };
    } else if (filter === 'unanswered') {
      whereExtras.messages = {
        every: { direction: 'INCOMING' },
      };
      whereExtras.unreadCount = { gt: 0 };
    } else if (filter === 'answered') {
      whereExtras.messages = {
        some: { direction: 'OUTGOING' },
      };
    } else if (filter === 'followup') {
      whereExtras.contact = {
        ...whereExtras.contact,
        tasks: { some: { status: 'PENDING' } },
      };
    } else if (assignedTo) {
      whereExtras.assignments = {
        some: { userId: assignedTo, unassignedAt: null },
      };
    }

    if (search) {
      const searchConditions = [
        { name: { contains: search, mode: 'insensitive' as const } },
        { surname: { contains: search, mode: 'insensitive' as const } },
        { phone: { contains: search } },
      ];
      if (whereExtras.contact) {
        whereExtras.contact = { ...whereExtras.contact, OR: searchConditions };
      } else {
        whereExtras.contact = { OR: searchConditions };
      }
    }

    // WhatsApp kanallarını filtrele (newsletter ve broadcast)
    // Gruplar (@g.us) ve bireysel sohbetler (@c.us) görünür
    const channelFilter = {
      contact: {
        ...whereExtras.contact,
        NOT: {
          OR: [
            { phone: { contains: '@newsletter' } },
            { phone: { contains: '@broadcast' } },
          ],
        },
      },
    };
    if (whereExtras.contact) {
      whereExtras.contact = channelFilter.contact;
    } else {
      whereExtras.contact = channelFilter.contact;
    }

    const where = whereConversationsForOrg(user, whereExtras);

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: {
          contact: { include: { lead: true } },
          session: { select: { id: true, name: true, phone: true, organizationId: true } },
          assignments: {
            where: { unassignedAt: null },
            include: {
              user: { select: { id: true, name: true, avatar: true } },
            },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return { conversations, total, page, totalPages: Math.ceil(total / limit) };
  }

  /** Teklif sayfası gömülü chat: kişiye ait son görüşme (herhangi bir oturum). */
  async findLatestByContactId(contactId: string) {
    return this.prisma.conversation.findFirst({
      where: { contactId },
      include: {
        contact: { include: { lead: true } },
        session: { select: { id: true, name: true, phone: true, organizationId: true } },
        assignments: {
          where: { unassignedAt: null },
          include: {
            user: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  async findById(id: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        contact: { include: { lead: true } },
        session: true,
        assignments: {
          where: { unassignedAt: null },
          include: {
            user: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Görüşme bulunamadı');
    return {
      ...conversation,
      isGroup: conversation.isGroup ?? false,
      groupName: conversation.groupName,
      waGroupId: conversation.waGroupId,
    };
  }

  async markAsRead(id: string) {
    return this.prisma.conversation.update({
      where: { id },
      data: { unreadCount: 0 },
    });
  }

  async archive(id: string) {
    return this.prisma.conversation.update({
      where: { id },
      data: { isArchived: true },
    });
  }

  async assign(conversationId: string, userId: string) {
    await this.prisma.assignment.updateMany({
      where: { conversationId, unassignedAt: null },
      data: { unassignedAt: new Date() },
    });

    return this.prisma.assignment.create({
      data: { conversationId, userId },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
  }

  async autoAssignRoundRobin(conversationId: string, organizationId?: string) {
    const agentWhere: any = { role: 'AGENT', isActive: true };
    if (organizationId) agentWhere.organizationId = organizationId;

    const agents = await this.prisma.user.findMany({
      where: agentWhere,
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });

    if (agents.length === 0) return null;

    const agentIds = agents.map((a) => a.id);
    const lastAssignment = await this.prisma.assignment.findFirst({
      where: { userId: { in: agentIds } },
      orderBy: { assignedAt: 'desc' },
      select: { userId: true },
    });

    let nextIndex = 0;
    if (lastAssignment) {
      const lastIdx = agents.findIndex((a) => a.id === lastAssignment.userId);
      nextIndex = lastIdx >= 0 ? (lastIdx + 1) % agents.length : 0;
    }

    return this.assign(conversationId, agents[nextIndex].id);
  }

  async updateLastMessage(id: string, text: string, timestamp?: Date) {
    return this.prisma.conversation.update({
      where: { id },
      data: { lastMessageText: text, lastMessageAt: timestamp || new Date() },
    });
  }

  async incrementUnread(id: string) {
    return this.prisma.conversation.update({
      where: { id },
      data: { unreadCount: { increment: 1 } },
    });
  }

  async addInternalNote(
    conversationId: string,
    userId: string,
    body: string,
  ) {
    return this.prisma.internalNote.create({
      data: { conversationId, userId, body },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async getHistory(
    user: OrgSessionScopeUser,
    params: {
      search?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, from, to, page = 1, limit = 100 } = params;
    const whereExtras: any = {};

    if (from || to) {
      whereExtras.lastMessageAt = {};
      if (from) whereExtras.lastMessageAt.gte = new Date(from);
      if (to) whereExtras.lastMessageAt.lte = new Date(to);
    }

    if (search) {
      whereExtras.contact = {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { surname: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search } },
        ],
      };
    }

    const where = whereConversationsForOrg(user, whereExtras);

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: {
          contact: {
            select: {
              id: true,
              phone: true,
              name: true,
              surname: true,
            },
          },
          session: { select: { id: true, name: true } },
          assignments: {
            where: { unassignedAt: null },
            include: {
              user: { select: { id: true, name: true } },
            },
          },
          _count: { select: { messages: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return {
      conversations: conversations.map((c) => ({
        ...c,
        messageCount: c._count.messages,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getInternalNotes(conversationId: string) {
    return this.prisma.internalNote.findMany({
      where: { conversationId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
