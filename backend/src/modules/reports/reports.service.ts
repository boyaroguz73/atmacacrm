import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

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

  /** Gelen / giden mesaj — günlük seri (timestamp) */
  async getMessageTimeseries(dateFrom?: Date, dateTo?: Date, organizationId?: string) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    try {
      const orgClause = organizationId
        ? Prisma.sql`AND ws."organizationId" = ${organizationId}::uuid`
        : Prisma.empty;
      const rows = await this.prisma.$queryRaw<{ day: Date | string; incoming: bigint; outgoing: bigint }[]>`
        SELECT date_trunc('day', m."timestamp")::date AS day,
          SUM(CASE WHEN m.direction = 'INCOMING'::"MessageDirection" THEN 1 ELSE 0 END)::bigint AS incoming,
          SUM(CASE WHEN m.direction = 'OUTGOING'::"MessageDirection" THEN 1 ELSE 0 END)::bigint AS outgoing
        FROM messages m
        INNER JOIN conversations conv ON conv.id = m."conversationId"
        INNER JOIN whatsapp_sessions ws ON ws.id = conv."sessionId"
        WHERE m."timestamp" >= ${from} AND m."timestamp" <= ${to}
        ${orgClause}
        GROUP BY 1
        ORDER BY 1 ASC
      `;
      return rows.map((r) => ({
        day: new Date(r.day).toISOString().slice(0, 10),
        incoming: Number(r.incoming),
        outgoing: Number(r.outgoing),
      }));
    } catch (error) {
      this.logger.warn(`Message timeseries fallback (empty): ${(error as Error).message}`);
      return [];
    }
  }

  /** Kasa hareketleri — günlük (elle girilen) */
  async getCashTimeseries(dateFrom?: Date, dateTo?: Date) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    try {
      const rows = await this.prisma.$queryRaw<{ day: Date | string; income: number; expense: number }[]>`
        SELECT date_trunc('day', c."occurredAt")::date AS day,
          COALESCE(SUM(CASE WHEN c.direction = 'INCOME'::"CashDirection" THEN c.amount ELSE 0 END), 0)::float AS income,
          COALESCE(SUM(CASE WHEN c.direction = 'EXPENSE'::"CashDirection" THEN c.amount ELSE 0 END), 0)::float AS expense
        FROM cash_book_entries c
        WHERE c."occurredAt" >= ${from} AND c."occurredAt" <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC
      `;
      return rows.map((r) => ({
        day: new Date(r.day).toISOString().slice(0, 10),
        income: r.income,
        expense: r.expense,
      }));
    } catch (error) {
      this.logger.warn(`Cash timeseries fallback (empty): ${(error as Error).message}`);
      return [];
    }
  }

  async getLeadFunnel(dateFrom?: Date, dateTo?: Date, organizationId?: string) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    const orgLeadWhere = organizationId ? { contact: { organizationId } } : {};
    const [byStatus, lostInPeriod, wonInPeriod, newInPeriod] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['status'],
        where: { ...orgLeadWhere },
        _count: { id: true },
      }),
      this.prisma.lead.count({
        where: {
          status: 'LOST',
          updatedAt: { gte: from, lte: to },
          ...orgLeadWhere,
        },
      }),
      this.prisma.lead.count({
        where: {
          status: 'WON',
          updatedAt: { gte: from, lte: to },
          ...orgLeadWhere,
        },
      }),
      this.prisma.lead.count({
        where: {
          createdAt: { gte: from, lte: to },
          ...orgLeadWhere,
        },
      }),
    ]);
    const statusMap = Object.fromEntries(byStatus.map((s) => [s.status, s._count.id]));
    const totalPipeline = Object.values(statusMap).reduce((a, b) => a + b, 0);
    const interestedPlus = (statusMap['INTERESTED'] || 0) + (statusMap['OFFER_SENT'] || 0) + (statusMap['WON'] || 0) + (statusMap['LOST'] || 0);
    const conversionOfferToWon =
      (statusMap['OFFER_SENT'] || 0) > 0
        ? Math.round(((statusMap['WON'] || 0) / (statusMap['OFFER_SENT'] || 1)) * 1000) / 10
        : null;
    const conversionNewToWon =
      newInPeriod > 0 ? Math.round(((wonInPeriod / newInPeriod) * 1000)) / 10 : null;

    return {
      byStatus: statusMap,
      lostInPeriod,
      wonInPeriod,
      newLeadsInPeriod: newInPeriod,
      totalPipeline,
      conversionOfferToWonPercent: conversionOfferToWon,
      conversionNewToWonInPeriodPercent: conversionNewToWon,
      interestedPlus,
    };
  }

  /** Sipariş satırlarından kategori geliri (ürün.category) */
  async getTopProductCategories(dateFrom?: Date, dateTo?: Date, organizationId?: string, limit = 12) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    try {
      const orgClause = organizationId
        ? Prisma.sql`AND c."organizationId" = ${organizationId}::uuid`
        : Prisma.empty;
      const rows = await this.prisma.$queryRaw<{ cat: string | null; qty: number; revenue: number }[]>`
        SELECT COALESCE(NULLIF(TRIM(p.category), ''), '(Kategorisiz)') AS cat,
          SUM(oi.quantity)::float AS qty,
          SUM(oi."lineTotal")::float AS revenue
        FROM order_items oi
        INNER JOIN sales_orders o ON oi."orderId" = o.id
        INNER JOIN contacts c ON o."contactId" = c.id
        LEFT JOIN products p ON oi."productId" = p.id
        WHERE o."createdAt" >= ${from} AND o."createdAt" <= ${to}
          AND o.status <> 'CANCELLED'::"OrderStatus"
        ${orgClause}
        GROUP BY 1
        ORDER BY revenue DESC NULLS LAST
        LIMIT ${limit}
      `;
      return rows.map((r) => ({
        category: r.cat,
        quantity: r.qty,
        revenue: r.revenue,
      }));
    } catch (error) {
      this.logger.warn(`Top categories fallback (empty): ${(error as Error).message}`);
      return [];
    }
  }

  async getSoldProducts(
    dateFrom?: Date,
    dateTo?: Date,
    organizationId?: string,
    page = 1,
    limit = 30,
  ) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    const skip = (page - 1) * limit;
    const orderWhere: Prisma.SalesOrderWhereInput = {
      createdAt: { gte: from, lte: to },
      status: { not: 'CANCELLED' },
    };
    if (organizationId) orderWhere.contact = { organizationId };
    const where: Prisma.OrderItemWhereInput = { order: orderWhere };
    const [items, totalAgg] = await Promise.all([
      this.prisma.orderItem.findMany({
        where,
        skip,
        take: limit,
        orderBy: { lineTotal: 'desc' },
        include: {
          product: { select: { id: true, sku: true, name: true, category: true, imageUrl: true } },
          order: { select: { id: true, orderNumber: true, createdAt: true } },
        },
      }),
      this.prisma.orderItem.count({ where }),
    ]);
    return { items, total: totalAgg, page, totalPages: Math.ceil(totalAgg / limit) };
  }

  async getInvoicesReport(dateFrom?: Date, dateTo?: Date, organizationId?: string, page = 1, limit = 40) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    const skip = (page - 1) * limit;
    const where: Prisma.AccountingInvoiceWhereInput = {
      createdAt: { gte: from, lte: to },
      ...(organizationId ? { contact: { organizationId } } : {}),
    };
    const [invoices, total, sumGrand] = await Promise.all([
      this.prisma.accountingInvoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          contact: { select: { id: true, name: true, phone: true, company: true } },
          order: { select: { id: true, orderNumber: true } },
        },
      }),
      this.prisma.accountingInvoice.count({ where }),
      this.prisma.accountingInvoice.aggregate({
        where,
        _sum: { grandTotal: true },
      }),
    ]);
    return {
      invoices,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      sumGrandTotal: sumGrand._sum.grandTotal ?? 0,
    };
  }

  /** Dönemde en az bir mesajı olan benzersiz kişi sayısı + sayfalı liste */
  async getEngagedContacts(dateFrom?: Date, dateTo?: Date, organizationId?: string, page = 1, limit = 40) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    try {
      const orgClause = organizationId
        ? Prisma.sql`AND c."organizationId" = ${organizationId}::uuid`
        : Prisma.empty;
      const countRows = await this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT conv."contactId")::bigint AS n
        FROM messages m
        INNER JOIN conversations conv ON conv.id = m."conversationId"
        INNER JOIN contacts c ON c.id = conv."contactId"
        WHERE m."timestamp" >= ${from} AND m."timestamp" <= ${to}
        ${orgClause}
      `;
      const total = Number(countRows[0]?.n ?? 0);
      const skip = (page - 1) * limit;
      const rows = await this.prisma.$queryRaw<
        { contactId: string; name: string | null; phone: string; msgCount: bigint }[]
      >`
        SELECT c.id AS "contactId", c.name, c.phone, COUNT(m.id)::bigint AS "msgCount"
        FROM messages m
        INNER JOIN conversations conv ON conv.id = m."conversationId"
        INNER JOIN contacts c ON c.id = conv."contactId"
        WHERE m."timestamp" >= ${from} AND m."timestamp" <= ${to}
        ${orgClause}
        GROUP BY c.id, c.name, c.phone
        ORDER BY "msgCount" DESC
        LIMIT ${limit} OFFSET ${skip}
      `;
      return {
        totalDistinctContacts: total,
        page,
        totalPages: Math.ceil(total / limit),
        rows: rows.map((r) => ({
          contactId: r.contactId,
          name: r.name,
          phone: r.phone,
          messageCount: Number(r.msgCount),
        })),
      };
    } catch (error) {
      this.logger.warn(`Engaged contacts fallback (empty): ${(error as Error).message}`);
      return {
        totalDistinctContacts: 0,
        page,
        totalPages: 0,
        rows: [],
      };
    }
  }

  /** Tek ekranda özet (rapor ana sayfası) */
  async getExecutiveDashboard(dateFrom?: Date, dateTo?: Date, organizationId?: string) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    const [
      summary,
      agents,
      msgSeries,
      cashSeries,
      funnel,
      topCategories,
      invoiceAgg,
      ordersAgg,
    ] = await Promise.all([
      this.getSummary(from, to, organizationId).catch((e) => {
        this.logger.warn(`Dashboard summary fallback: ${(e as Error).message}`);
        return {
          period: { from, to },
          totalMessages: 0,
          incomingMessages: 0,
          outgoingMessages: 0,
          newContacts: 0,
          totalConversations: 0,
          unansweredTotal: 0,
          leadConversions: 0,
        };
      }),
      this.getAgentDetailedReport(from, to, organizationId).catch((e) => {
        this.logger.warn(`Dashboard agents fallback: ${(e as Error).message}`);
        return [];
      }),
      this.getMessageTimeseries(from, to, organizationId),
      this.getCashTimeseries(from, to),
      this.getLeadFunnel(from, to, organizationId).catch((e) => {
        this.logger.warn(`Dashboard funnel fallback: ${(e as Error).message}`);
        return {
          byStatus: {},
          lostInPeriod: 0,
          wonInPeriod: 0,
          newLeadsInPeriod: 0,
          totalPipeline: 0,
          conversionOfferToWonPercent: null,
          conversionNewToWonInPeriodPercent: null,
          interestedPlus: 0,
        };
      }),
      this.getTopProductCategories(from, to, organizationId, 8),
      this.prisma.accountingInvoice.aggregate({
        where: {
          createdAt: { gte: from, lte: to },
          ...(organizationId ? { contact: { organizationId } } : {}),
        },
        _count: { id: true },
        _sum: { grandTotal: true },
      }).catch((e) => {
        this.logger.warn(`Dashboard invoice aggregate fallback: ${(e as Error).message}`);
        return { _count: { id: 0 }, _sum: { grandTotal: 0 } };
      }),
      this.prisma.salesOrder.aggregate({
        where: {
          createdAt: { gte: from, lte: to },
          status: { not: 'CANCELLED' },
          ...(organizationId ? { contact: { organizationId } } : {}),
        },
        _count: { id: true },
        _sum: { grandTotal: true },
      }).catch((e) => {
        this.logger.warn(`Dashboard order aggregate fallback: ${(e as Error).message}`);
        return { _count: { id: 0 }, _sum: { grandTotal: 0 } };
      }),
    ]);

    return {
      summary,
      agents,
      charts: {
        messages: msgSeries,
        cash: cashSeries,
        topCategories,
      },
      funnel,
      invoices: {
        count: invoiceAgg._count.id,
        sumGrandTotal: invoiceAgg._sum.grandTotal ?? 0,
      },
      orders: {
        count: ordersAgg._count.id,
        sumGrandTotal: ordersAgg._sum.grandTotal ?? 0,
      },
    };
  }
}
