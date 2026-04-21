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
    const now = new Date();

    const mf = this.orgMessageFilter(organizationId);
    const cf = this.orgConvFilter(organizationId);
    const contactFilter = organizationId ? { organizationId } : {};
    const leadFilter = organizationId
      ? { contact: { organizationId } }
      : {};
    const orderFilter: any = organizationId
      ? { contact: { organizationId }, ...dateFilter }
      : { ...dateFilter };
    // Outstanding (kalan bakiye) hesabında "o gün yaratılan" değil, "tahsil edilmemiş olan" tüm
    // siparişleri görmek istediğimiz için tarih filtresini KULLANMIYORUZ.
    const allOrdersFilter: any = organizationId ? { contact: { organizationId } } : {};

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
      ordersByStatus,
      allOrdersGrandTotalAgg,
      allOrderPaymentsAgg,
      overdueDeliveries,
      cashIncome,
      cashExpense,
      quotesByStatus,
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
      // Siparişlerin duruma göre dağılımı (dönem filtresiz, anlık durum)
      this.prisma.salesOrder.groupBy({
        by: ['status'],
        where: allOrdersFilter,
        _count: { _all: true },
        _sum: { grandTotal: true },
      }),
      // Tüm açık/teslim edilmiş sipariş ciro toplamı (iptaller hariç)
      this.prisma.salesOrder.aggregate({
        where: { ...allOrdersFilter, status: { not: 'CANCELLED' } },
        _sum: { grandTotal: true },
      }),
      // Tüm siparişlere ilişkin tahsilat/iade toplamları (outstanding hesabı için)
      this.prisma.cashBookEntry.groupBy({
        by: ['direction'],
        where: this.orgCashWhere(organizationId, { orderId: { not: null } }),
        _sum: { amount: true },
      }),
      // Gecikmiş teslimatlar: beklenen tarih geçmiş ama teslim/iptal değil
      this.prisma.salesOrder.count({
        where: {
          ...allOrdersFilter,
          expectedDeliveryDate: { lt: now },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      }),
      this.cashAggregate(organizationId, 'INCOME', dateRange),
      this.cashAggregate(organizationId, 'EXPENSE', dateRange),
      // Teklif dönüşümü: dönem içinde oluşturulan teklifler duruma göre
      this.prisma.quote.groupBy({
        by: ['status'],
        where: {
          ...(organizationId ? { contact: { organizationId } } : {}),
          ...(dateRange ? { createdAt: dateRange } : {}),
        },
        _count: { _all: true },
        _sum: { grandTotal: true },
      }),
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

    // Outstanding hesabı: açık ciro - (tahsilat - iade)
    const orderGross = allOrdersGrandTotalAgg._sum.grandTotal || 0;
    let allOrderIncome = 0;
    let allOrderExpense = 0;
    for (const row of allOrderPaymentsAgg) {
      if (row.direction === 'INCOME') allOrderIncome = row._sum.amount || 0;
      else if (row.direction === 'EXPENSE') allOrderExpense = row._sum.amount || 0;
    }
    const collectedNet = allOrderIncome - allOrderExpense;
    const outstandingTotal = Math.max(0, Math.round((orderGross - collectedNet) * 100) / 100);

    // Teklif dönüşüm oranı: ACCEPTED / (oluşturulanlar)
    const totalQuotes = quotesByStatus.reduce((s, q) => s + q._count._all, 0);
    const acceptedQuotes = quotesByStatus
      .filter((q) => q.status === 'ACCEPTED')
      .reduce((s, q) => s + q._count._all, 0);
    const quoteConversionRate =
      totalQuotes > 0 ? Math.round((acceptedQuotes / totalQuotes) * 10000) / 100 : 0;

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
        outstandingTotal,
        collectedTotal: Math.round(collectedNet * 100) / 100,
        overdueDeliveries,
        byStatus: ordersByStatus.map((o) => ({
          status: o.status,
          count: o._count._all,
          sumGrandTotal: o._sum.grandTotal || 0,
        })),
      },
      quotes: {
        total: totalQuotes,
        accepted: acceptedQuotes,
        conversionRate: quoteConversionRate,
        byStatus: quotesByStatus.map((q) => ({
          status: q.status,
          count: q._count._all,
          sumGrandTotal: q._sum.grandTotal || 0,
        })),
      },
      cash: {
        income: cashIncome,
        expense: cashExpense,
        net: cashIncome - cashExpense,
      },
    };
  }

  /**
   * CashBookEntry için organizasyon filtresini oluştur.
   * CashBookEntry'de doğrudan organizationId yok; user.organizationId üzerinden
   * eşleşme yapıyoruz (kullanıcıyı hangi organizasyonda ise onun kasa hareketi).
   */
  private orgCashWhere(organizationId?: string, extra: any = {}) {
    const base: any = { ...extra };
    if (organizationId) base.user = { organizationId };
    return base;
  }

  private parseDateRange(from?: string, to?: string) {
    if (!from && !to) return null;
    const range: any = {};
    if (from) range.gte = new Date(from);
    if (to) range.lte = new Date(to);
    return range;
  }

  /**
   * CashBookEntry agregat toplamı (INCOME/EXPENSE) — organizasyon filtresi user.organizationId'den.
   * Tarih alanı `occurredAt`; `dateRange` verilirse onunla sınırlanır.
   */
  private async cashAggregate(
    organizationId?: string,
    direction?: 'INCOME' | 'EXPENSE',
    dateRange?: any,
  ): Promise<number> {
    const where: any = {};
    if (direction) where.direction = direction;
    if (dateRange) where.occurredAt = dateRange;
    if (organizationId) where.user = { organizationId };
    try {
      const agg = await this.prisma.cashBookEntry.aggregate({
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
