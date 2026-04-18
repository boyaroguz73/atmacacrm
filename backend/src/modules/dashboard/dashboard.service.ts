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

  async getOverview(organizationId?: string, from?: string, to?: string) {
    const dateRange = this.parseDateRange(from, to);
    const dateFilter = dateRange ? { createdAt: dateRange } : {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const mf = this.orgMessageFilter(organizationId);
    const cf = this.orgConvFilter(organizationId);
    const contactFilter = organizationId ? { organizationId } : {};
    const leadFilter = organizationId
      ? { contact: { organizationId } }
      : {};
    const orderFilter: any = organizationId
      ? { contact: { organizationId }, ...dateFilter }
      : { ...dateFilter };

    const msgDateFilter = dateRange
      ? { createdAt: dateRange, ...mf }
      : { createdAt: { gte: today }, ...mf };

    const [
      totalMessages,
      incomingMessages,
      outgoingMessages,
      activeConversations,
      unansweredConversations,
      totalContacts,
      newContactsInPeriod,
      totalLeads,
      leadsByStatus,
      agentStats,
      orderAgg,
      cashIncome,
      cashExpense,
    ] = await Promise.all([
      this.prisma.message.count({ where: msgDateFilter }),
      this.prisma.message.count({
        where: { ...msgDateFilter, direction: 'INCOMING' },
      }),
      this.prisma.message.count({
        where: { ...msgDateFilter, direction: 'OUTGOING' },
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
      this.prisma.contact.count({
        where: { ...contactFilter, ...(dateRange ? { createdAt: dateRange } : {}) },
      }),
      this.prisma.lead.count({ where: leadFilter }),
      this.prisma.lead.groupBy({
        by: ['status'],
        where: {
          ...leadFilter,
          ...(dateRange ? { createdAt: dateRange } : {}),
        },
        _count: { id: true },
        _sum: { value: true },
      }),
      this.getAgentPerformance(organizationId, dateRange),
      this.prisma.salesOrder.aggregate({
        where: orderFilter,
        _sum: { grandTotal: true },
        _count: { id: true },
      }),
      this.safeCashAggregate(organizationId, 'INCOME', dateRange),
      this.safeCashAggregate(organizationId, 'EXPENSE', dateRange),
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
      totalMessagesToday: totalMessages,
      incomingMessagesToday: incomingMessages,
      outgoingMessagesToday: outgoingMessages,
      activeConversations,
      unansweredConversations,
      totalContacts,
      newContactsInPeriod,
      totalLeads,
      conversionRate: Math.round(conversionRate * 100) / 100,
      leadsByStatus: leadsByStatus.map((l) => ({
        status: l.status,
        count: l._count.id,
        totalValue: l._sum.value || 0,
      })),
      agentStats,
      orders: {
        count: orderAgg._count.id,
        sumGrandTotal: orderAgg._sum.grandTotal || 0,
      },
      cash: {
        income: cashIncome,
        expense: cashExpense,
        net: cashIncome - cashExpense,
      },
    };
  }

  private parseDateRange(from?: string, to?: string) {
    if (!from && !to) return null;
    const range: any = {};
    if (from) range.gte = new Date(from);
    if (to) range.lte = new Date(to);
    return range;
  }

  private async safeCashAggregate(
    organizationId?: string,
    type?: string,
    dateRange?: any,
  ): Promise<number> {
    try {
      const where: any = {};
      if (organizationId) where.organizationId = organizationId;
      if (type) where.type = type;
      if (dateRange) where.date = dateRange;
      const agg = await (this.prisma as any).cashEntry.aggregate({
        where,
        _sum: { amount: true },
      });
      return agg._sum.amount || 0;
    } catch {
      return 0;
    }
  }

  async getAgentPerformance(organizationId?: string, dateRange?: any) {
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

    const msgFilter = dateRange || { gte: today };

    const agentStats = await Promise.all(
      agents.map(async (agent) => {
        const messagesToday = await this.prisma.message.count({
          where: {
            sentById: agent.id,
            createdAt: msgFilter,
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
