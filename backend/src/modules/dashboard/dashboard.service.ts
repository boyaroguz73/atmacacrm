import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  private orgMessageFilter(orgId?: string) {
    return orgId ? { session: { organizationId: orgId } } : {};
  }

  private orgConvFilter(orgId?: string) {
    return orgId ? { session: { organizationId: orgId } } : {};
  }

  async getOverview(organizationId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const mf = this.orgMessageFilter(organizationId);
    const cf = this.orgConvFilter(organizationId);
    const contactFilter = organizationId ? { organizationId } : {};
    const leadFilter = organizationId
      ? { contact: { organizationId } }
      : {};
    const agentFilter = organizationId ? { organizationId } : {};

    const [
      totalMessagesToday,
      incomingMessagesToday,
      outgoingMessagesToday,
      activeConversations,
      unansweredConversations,
      totalContacts,
      totalLeads,
      leadsByStatus,
      agentStats,
    ] = await Promise.all([
      this.prisma.message.count({
        where: { createdAt: { gte: today }, ...mf },
      }),
      this.prisma.message.count({
        where: { createdAt: { gte: today }, direction: 'INCOMING', ...mf },
      }),
      this.prisma.message.count({
        where: { createdAt: { gte: today }, direction: 'OUTGOING', ...mf },
      }),
      this.prisma.conversation.count({
        where: { isClosed: false, isArchived: false, ...cf },
      }),
      this.prisma.conversation.count({
        where: {
          isClosed: false,
          isArchived: false,
          unreadCount: { gt: 0 },
          ...cf,
        },
      }),
      this.prisma.contact.count({ where: contactFilter }),
      this.prisma.lead.count({ where: leadFilter }),
      this.prisma.lead.groupBy({
        by: ['status'],
        where: leadFilter,
        _count: { id: true },
        _sum: { value: true },
      }),
      this.getAgentPerformance(organizationId),
    ]);

    const wonLeads = leadsByStatus.find((l) => l.status === 'WON');
    const totalLeadsForConversion = leadsByStatus.reduce(
      (sum, l) => sum + l._count.id,
      0,
    );
    const conversionRate =
      totalLeadsForConversion > 0
        ? ((wonLeads?._count.id || 0) / totalLeadsForConversion) * 100
        : 0;

    return {
      totalMessagesToday,
      incomingMessagesToday,
      outgoingMessagesToday,
      activeConversations,
      unansweredConversations,
      totalContacts,
      totalLeads,
      conversionRate: Math.round(conversionRate * 100) / 100,
      leadsByStatus: leadsByStatus.map((l) => ({
        status: l.status,
        count: l._count.id,
        totalValue: l._sum.value || 0,
      })),
      agentStats,
    };
  }

  async getAgentPerformance(organizationId?: string) {
    const agentWhere: any = { role: 'AGENT', isActive: true };
    if (organizationId) agentWhere.organizationId = organizationId;

    const agents = await this.prisma.user.findMany({
      where: agentWhere,
      select: {
        id: true,
        name: true,
        avatar: true,
        _count: {
          select: {
            sentMessages: true,
            assignments: true,
          },
        },
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const agentStats = await Promise.all(
      agents.map(async (agent) => {
        const messagesToday = await this.prisma.message.count({
          where: {
            sentById: agent.id,
            createdAt: { gte: today },
          },
        });

        const activeAssignments = await this.prisma.assignment.count({
          where: { userId: agent.id, unassignedAt: null },
        });

        return {
          id: agent.id,
          name: agent.name,
          avatar: agent.avatar,
          totalMessages: agent._count.sentMessages,
          messagesToday,
          activeAssignments,
          totalAssignments: agent._count.assignments,
        };
      }),
    );

    return agentStats;
  }

  async getMessageStats(days: number = 7, organizationId?: string) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const mf = this.orgMessageFilter(organizationId);

    const messages = await this.prisma.message.findMany({
      where: { createdAt: { gte: startDate }, ...mf },
      select: { direction: true, createdAt: true },
    });

    const dailyStats: Record<
      string,
      { date: string; incoming: number; outgoing: number }
    > = {};

    for (let i = 0; i <= days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const key = date.toISOString().split('T')[0];
      dailyStats[key] = { date: key, incoming: 0, outgoing: 0 };
    }

    messages.forEach((msg) => {
      const key = msg.createdAt.toISOString().split('T')[0];
      if (dailyStats[key]) {
        if (msg.direction === 'INCOMING') dailyStats[key].incoming++;
        else dailyStats[key].outgoing++;
      }
    });

    return Object.values(dailyStats);
  }
}
