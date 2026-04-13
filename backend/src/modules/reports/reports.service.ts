import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getAgentDetailedReport(dateFrom?: Date, dateTo?: Date, organizationId?: string) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();

    const where: any = { role: 'AGENT', isActive: true };
    if (organizationId) {
      where.organizationId = organizationId;
    }

    const agents = await this.prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, avatar: true },
    });

    const report = await Promise.all(
      agents.map(async (agent) => {
        const [
          totalMessagesSent,
          totalMessagesInPeriod,
          uniqueContactsMessaged,
          activeConversations,
          unansweredConversations,
          avgResponseTime,
          taskStats,
        ] = await Promise.all([
          this.prisma.message.count({
            where: {
              sentById: agent.id,
              createdAt: { gte: from, lte: to },
            },
          }),
          this.getAgentHandledMessages(agent.id, from, to),
          this.getUniqueContactsCount(agent.id, from, to),
          this.prisma.assignment.count({
            where: { userId: agent.id, unassignedAt: null },
          }),
          this.getUnansweredCount(agent.id),
          this.calculateAvgResponseTime(agent.id, from, to),
          this.getAgentTaskStats(agent.id),
        ]);

        return {
          agent: {
            id: agent.id,
            name: agent.name,
            email: agent.email,
            avatar: agent.avatar,
          },
          totalMessagesSent,
          totalMessagesInPeriod,
          uniqueContactsMessaged,
          activeConversations,
          unansweredConversations,
          avgResponseTimeMinutes: avgResponseTime,
          taskStats,
        };
      }),
    );

    return report;
  }

  private async getAgentHandledMessages(
    agentId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const assignments = await this.prisma.assignment.findMany({
      where: { userId: agentId },
      select: { conversationId: true },
    });
    const convIds = assignments.map((a) => a.conversationId);
    if (convIds.length === 0) return 0;

    return this.prisma.message.count({
      where: {
        conversationId: { in: convIds },
        createdAt: { gte: from, lte: to },
      },
    });
  }

  private async getUniqueContactsCount(
    agentId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const result = await this.prisma.message.findMany({
      where: {
        sentById: agentId,
        createdAt: { gte: from, lte: to },
      },
      select: { conversationId: true },
      distinct: ['conversationId'],
    });
    return result.length;
  }

  private async getUnansweredCount(agentId: string): Promise<number> {
    const assignments = await this.prisma.assignment.findMany({
      where: { userId: agentId, unassignedAt: null },
      select: { conversationId: true },
    });
    if (assignments.length === 0) return 0;

    const convIds = assignments.map((a) => a.conversationId);

    return this.prisma.conversation.count({
      where: {
        id: { in: convIds },
        unreadCount: { gt: 0 },
      },
    });
  }

  private async calculateAvgResponseTime(
    agentId: string,
    from: Date,
    to: Date,
  ): Promise<number | null> {
    try {
      const rows = await this.prisma.$queryRaw<
        { avg_minutes: number | null }[]
      >`
        SELECT AVG(EXTRACT(EPOCH FROM (r."timestamp" - i."timestamp")) / 60.0)
          AS avg_minutes
        FROM messages i
        INNER JOIN LATERAL (
          SELECT m."timestamp"
          FROM messages m
          WHERE m."conversationId" = i."conversationId"
            AND m.direction = 'OUTGOING'::"MessageDirection"
            AND m."sentById" = ${agentId}::uuid
            AND m."timestamp" > i."timestamp"
          ORDER BY m."timestamp" ASC
          LIMIT 1
        ) r ON true
        WHERE i.direction = 'INCOMING'::"MessageDirection"
          AND i."createdAt" >= ${from}
          AND i."createdAt" <= ${to}
          AND EXISTS (
            SELECT 1
            FROM assignments a
            WHERE a."conversationId" = i."conversationId"
              AND a."userId" = ${agentId}::uuid
          )
          AND EXTRACT(EPOCH FROM (r."timestamp" - i."timestamp")) / 60.0 < 1440
      `;

      const avg = rows[0]?.avg_minutes;
      if (avg == null || Number.isNaN(Number(avg))) return null;
      return Math.round(Number(avg));
    } catch {
      return null;
    }
  }

  private async getAgentTaskStats(agentId: string) {
    const [pending, overdue, completed] = await Promise.all([
      this.prisma.task.count({
        where: { userId: agentId, status: 'PENDING' },
      }),
      this.prisma.task.count({
        where: {
          userId: agentId,
          status: 'PENDING',
          dueAt: { lte: new Date() },
        },
      }),
      this.prisma.task.count({
        where: { userId: agentId, status: 'COMPLETED' },
      }),
    ]);
    return { pending, overdue, completed };
  }

  async getSummary(dateFrom?: Date, dateTo?: Date, organizationId?: string) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();

    const sessionFilter = organizationId
      ? { session: { organizationId } }
      : {};

    const contactFilter = organizationId
      ? { organizationId }
      : {};

    const [
      totalMessages,
      incomingMessages,
      outgoingMessages,
      newContacts,
      totalConversations,
      unansweredTotal,
      leadConversions,
    ] = await Promise.all([
      this.prisma.message.count({
        where: { createdAt: { gte: from, lte: to }, ...sessionFilter },
      }),
      this.prisma.message.count({
        where: { createdAt: { gte: from, lte: to }, direction: 'INCOMING', ...sessionFilter },
      }),
      this.prisma.message.count({
        where: { createdAt: { gte: from, lte: to }, direction: 'OUTGOING', ...sessionFilter },
      }),
      this.prisma.contact.count({
        where: { createdAt: { gte: from, lte: to }, ...contactFilter },
      }),
      this.prisma.conversation.count({
        where: { createdAt: { gte: from, lte: to }, ...sessionFilter },
      }),
      this.prisma.conversation.count({
        where: { unreadCount: { gt: 0 }, isClosed: false, ...sessionFilter },
      }),
      this.prisma.lead.count({
        where: {
          status: 'WON',
          updatedAt: { gte: from, lte: to },
          ...(organizationId ? { contact: { organizationId } } : {}),
        },
      }),
    ]);

    return {
      period: { from, to },
      totalMessages,
      incomingMessages,
      outgoingMessages,
      newContacts,
      totalConversations,
      unansweredTotal,
      leadConversions,
    };
  }
}
