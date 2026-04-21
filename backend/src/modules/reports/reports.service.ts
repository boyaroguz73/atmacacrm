import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private prisma: PrismaService) {}

  async getAgentDetailedReport(dateFrom?: Date, dateTo?: Date, organizationId?: string, source?: string) {
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
          responseMetrics,
          taskStats,
          orderStats,
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
          this.calculateResponseMetrics(agent.id, from, to),
          this.getAgentTaskStats(agent.id),
          this.getAgentOrderStats(agent.id, from, to, source),
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
          avgResponseTimeMinutes:
            responseMetrics.avg != null ? Math.round(responseMetrics.avg) : null,
          responseMetrics,
          taskStats,
          orderStats,
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

  /**
   * Yanıt süresi metrikleri (dakika cinsinden).
   *
   * Her gelen mesaj (INCOMING) için, aynı konuşmada agent'ın attığı sonraki ilk
   * giden mesajı bulur ve aradaki farkı dakikaya çevirir. 1440 dk (24 saat) üstü
   * aykırı değerler (muhtemelen uyku / offline) hariç tutulur.
   *
   * Döndürülenler:
   *  - avg     : aritmetik ortalama
   *  - p50     : medyan (yarıdan daha hızlı mı?)
   *  - p90     : en yavaş %10 eşiği (SLA hedeflemede kritik)
   *  - total   : değerlendirmeye alınan yanıt çifti sayısı
   *  - sla30   : 30 dakika içinde yanıt oranı (%) — sla eşiği isteğe bağlı
   *  - slaBreaches : 30 dk'yi aşan yanıt sayısı
   */
  private async calculateResponseMetrics(
    agentId: string,
    from: Date,
    to: Date,
    slaThresholdMinutes = 30,
  ): Promise<{
    avg: number | null;
    p50: number | null;
    p90: number | null;
    total: number;
    sla30Percent: number | null;
    slaBreaches: number;
  }> {
    try {
      const rows = await this.prisma.$queryRaw<
        {
          avg_minutes: number | null;
          p50_minutes: number | null;
          p90_minutes: number | null;
          total: bigint;
          breaches: bigint;
        }[]
      >`
        WITH pairs AS (
          SELECT
            EXTRACT(EPOCH FROM (r."timestamp" - i."timestamp")) / 60.0 AS minutes
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
              SELECT 1 FROM assignments a
              WHERE a."conversationId" = i."conversationId"
                AND a."userId" = ${agentId}::uuid
            )
            AND EXTRACT(EPOCH FROM (r."timestamp" - i."timestamp")) / 60.0 < 1440
        )
        SELECT
          AVG(minutes)::float AS avg_minutes,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)::float AS p50_minutes,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY minutes)::float AS p90_minutes,
          COUNT(*)::bigint AS total,
          SUM(CASE WHEN minutes > ${slaThresholdMinutes}::float THEN 1 ELSE 0 END)::bigint AS breaches
        FROM pairs
      `;
      const row = rows[0];
      if (!row) {
        return { avg: null, p50: null, p90: null, total: 0, sla30Percent: null, slaBreaches: 0 };
      }
      const total = Number(row.total || 0);
      const breaches = Number(row.breaches || 0);
      const slaPercent =
        total > 0 ? Math.round(((total - breaches) / total) * 1000) / 10 : null;
      const round1 = (v: number | null) =>
        v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10) / 10;
      return {
        avg: round1(row.avg_minutes),
        p50: round1(row.p50_minutes),
        p90: round1(row.p90_minutes),
        total,
        sla30Percent: slaPercent,
        slaBreaches: breaches,
      };
    } catch (e) {
      this.logger.warn(`Agent response metrics fallback: ${(e as Error).message}`);
      return { avg: null, p50: null, p90: null, total: 0, sla30Percent: null, slaBreaches: 0 };
    }
  }

  private async getAgentOrderStats(agentId: string, from: Date, to: Date, source?: string) {
    try {
      const orderWhere: any = {
        createdById: agentId,
        createdAt: { gte: from, lte: to },
        status: { not: 'CANCELLED' },
        ...(source ? { source } : {}),
      };
      const [orderAgg, collectionAgg] = await Promise.all([
        this.prisma.salesOrder.aggregate({
          where: orderWhere,
          _count: { id: true },
          _sum: { grandTotal: true },
        }),
        this.prisma.cashBookEntry.aggregate({
          where: {
            userId: agentId,
            direction: 'INCOME',
            occurredAt: { gte: from, lte: to },
          },
          _sum: { amount: true },
          _count: { id: true },
        }),
      ]);
      return {
        orderCount: orderAgg._count.id,
        orderRevenue: Math.round((orderAgg._sum.grandTotal ?? 0) * 100) / 100,
        collectionAmount: Math.round((collectionAgg._sum.amount ?? 0) * 100) / 100,
        collectionCount: collectionAgg._count.id,
      };
    } catch {
      return { orderCount: 0, orderRevenue: 0, collectionAmount: 0, collectionCount: 0 };
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

  /** Tahsilat (CashBookEntry INCOME) — günlük zaman serisi */
  async getCollectionTimeseries(
    dateFrom?: Date,
    dateTo?: Date,
    organizationId?: string,
    source?: string,
  ) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    try {
      if (source || organizationId) {
        const sourceClause = source
          ? Prisma.sql`AND so.source = ${source}`
          : Prisma.empty;
        const orgClause = organizationId
          ? Prisma.sql`AND c."organizationId" = ${organizationId}::uuid`
          : Prisma.empty;
        const rows = await this.prisma.$queryRaw<{ day: Date | string; amount: number }[]>`
          SELECT date_trunc('day', cb."occurredAt")::date AS day,
            COALESCE(SUM(cb.amount), 0)::float AS amount
          FROM cash_book_entries cb
          INNER JOIN sales_orders so ON cb."orderId" = so.id
          INNER JOIN contacts c ON so."contactId" = c.id
          WHERE cb."occurredAt" >= ${from} AND cb."occurredAt" <= ${to}
            AND cb.direction = 'INCOME'::"CashDirection"
          ${sourceClause}
          ${orgClause}
          GROUP BY 1
          ORDER BY 1 ASC
        `;
        return rows.map((r) => ({
          day: new Date(r.day).toISOString().slice(0, 10),
          amount: Math.round((r.amount || 0) * 100) / 100,
        }));
      }
      const rows = await this.prisma.$queryRaw<{ day: Date | string; amount: number }[]>`
        SELECT date_trunc('day', cb."occurredAt")::date AS day,
          COALESCE(SUM(cb.amount), 0)::float AS amount
        FROM cash_book_entries cb
        WHERE cb."occurredAt" >= ${from} AND cb."occurredAt" <= ${to}
          AND cb.direction = 'INCOME'::"CashDirection"
        GROUP BY 1
        ORDER BY 1 ASC
      `;
      return rows.map((r) => ({
        day: new Date(r.day).toISOString().slice(0, 10),
        amount: Math.round((r.amount || 0) * 100) / 100,
      }));
    } catch (error) {
      this.logger.warn(`Collection timeseries error: ${(error as Error).message}`);
      return [];
    }
  }

  /** Tahsilat toplamı (CashBookEntry INCOME) — aggregate */
  async getCollectionRevenue(
    dateFrom?: Date,
    dateTo?: Date,
    organizationId?: string,
    source?: string,
  ) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    try {
      if (source || organizationId) {
        const sourceClause = source
          ? Prisma.sql`AND so.source = ${source}`
          : Prisma.empty;
        const orgClause = organizationId
          ? Prisma.sql`AND c."organizationId" = ${organizationId}::uuid`
          : Prisma.empty;
        const rows = await this.prisma.$queryRaw<{ total: number; cnt: bigint }[]>`
          SELECT COALESCE(SUM(cb.amount), 0)::float AS total, COUNT(cb.id)::bigint AS cnt
          FROM cash_book_entries cb
          INNER JOIN sales_orders so ON cb."orderId" = so.id
          INNER JOIN contacts c ON so."contactId" = c.id
          WHERE cb."occurredAt" >= ${from} AND cb."occurredAt" <= ${to}
            AND cb.direction = 'INCOME'::"CashDirection"
          ${sourceClause}
          ${orgClause}
        `;
        return {
          total: Math.round((rows[0]?.total || 0) * 100) / 100,
          count: Number(rows[0]?.cnt || 0),
        };
      }
      const rows = await this.prisma.$queryRaw<{ total: number; cnt: bigint }[]>`
        SELECT COALESCE(SUM(cb.amount), 0)::float AS total, COUNT(cb.id)::bigint AS cnt
        FROM cash_book_entries cb
        WHERE cb."occurredAt" >= ${from} AND cb."occurredAt" <= ${to}
          AND cb.direction = 'INCOME'::"CashDirection"
      `;
      return {
        total: Math.round((rows[0]?.total || 0) * 100) / 100,
        count: Number(rows[0]?.cnt || 0),
      };
    } catch (error) {
      this.logger.warn(`Collection revenue error: ${(error as Error).message}`);
      return { total: 0, count: 0 };
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

  /**
   * Sipariş bazlı satış trendi (zaman serisi).
   *
   * Bucket stratejisi:
   * - day   : her gün
   * - week  : ISO pazartesi başlangıçlı hafta
   * - month : takvim ayı
   *
   * Sipariş filtresi: status <> CANCELLED (iptal edilenleri hariç tut).
   * Ciro olarak `grandTotal` baz alınır (KDV dahil net brüt tutar).
   */
  async getSalesTimeseries(
    dateFrom?: Date,
    dateTo?: Date,
    organizationId?: string,
    granularity: 'day' | 'week' | 'month' = 'day',
    source?: string,
  ) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    const trunc = granularity === 'month' ? 'month' : granularity === 'week' ? 'week' : 'day';
    try {
      const orgClause = organizationId
        ? Prisma.sql`AND c."organizationId" = ${organizationId}::uuid`
        : Prisma.empty;
      const sourceClause = source
        ? Prisma.sql`AND o.source = ${source}`
        : Prisma.empty;
      const rows = await this.prisma.$queryRaw<
        { bucket: Date | string; count: bigint; revenue: number }[]
      >`
        SELECT date_trunc(${trunc}, o."createdAt")::date AS bucket,
          COUNT(*)::bigint AS count,
          COALESCE(SUM(o."grandTotal"), 0)::float AS revenue
        FROM sales_orders o
        INNER JOIN contacts c ON o."contactId" = c.id
        WHERE o."createdAt" >= ${from} AND o."createdAt" <= ${to}
          AND o.status <> 'CANCELLED'::"OrderStatus"
        ${orgClause}
        ${sourceClause}
        GROUP BY 1
        ORDER BY 1 ASC
      `;
      return rows.map((r) => {
        const count = Number(r.count);
        const revenue = Math.round((r.revenue || 0) * 100) / 100;
        return {
          bucket: new Date(r.bucket).toISOString().slice(0, 10),
          count,
          revenue,
          avgOrderValue: count > 0 ? Math.round((revenue / count) * 100) / 100 : 0,
        };
      });
    } catch (error) {
      this.logger.warn(`Sales timeseries fallback (empty): ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * En çok satan müşteriler (ciro sıralı).
   * İptal edilen siparişler hariç, verilen tarih aralığında sipariş veren kişileri döndürür.
   */
  async getTopCustomers(
    dateFrom?: Date,
    dateTo?: Date,
    organizationId?: string,
    limit = 10,
    source?: string,
  ) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    try {
      const orgClause = organizationId
        ? Prisma.sql`AND c."organizationId" = ${organizationId}::uuid`
        : Prisma.empty;
      const sourceClause = source
        ? Prisma.sql`AND o.source = ${source}`
        : Prisma.empty;
      const rows = await this.prisma.$queryRaw<
        {
          contactId: string;
          name: string | null;
          phone: string | null;
          orderCount: bigint;
          revenue: number;
        }[]
      >`
        SELECT c.id AS "contactId",
          c.name,
          c.phone,
          COUNT(o.id)::bigint AS "orderCount",
          COALESCE(SUM(o."grandTotal"), 0)::float AS revenue
        FROM sales_orders o
        INNER JOIN contacts c ON o."contactId" = c.id
        WHERE o."createdAt" >= ${from} AND o."createdAt" <= ${to}
          AND o.status <> 'CANCELLED'::"OrderStatus"
        ${orgClause}
        ${sourceClause}
        GROUP BY c.id, c.name, c.phone
        ORDER BY revenue DESC NULLS LAST
        LIMIT ${limit}
      `;
      return rows.map((r) => ({
        contactId: r.contactId,
        name: r.name || '—',
        phone: r.phone || '',
        orderCount: Number(r.orderCount),
        revenue: Math.round((r.revenue || 0) * 100) / 100,
      }));
    } catch (error) {
      this.logger.warn(`Top customers fallback (empty): ${(error as Error).message}`);
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
  async getTopProductCategories(dateFrom?: Date, dateTo?: Date, organizationId?: string, limit = 12, source?: string) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    try {
      const orgClause = organizationId
        ? Prisma.sql`AND c."organizationId" = ${organizationId}::uuid`
        : Prisma.empty;
      const sourceClause = source
        ? Prisma.sql`AND o.source = ${source}`
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
        ${sourceClause}
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
    source?: string,
  ) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    const skip = (page - 1) * limit;
    const orderWhere: Prisma.SalesOrderWhereInput = {
      createdAt: { gte: from, lte: to },
      status: { not: 'CANCELLED' },
      ...(source ? { source } : {}),
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
  async getExecutiveDashboard(
    dateFrom?: Date,
    dateTo?: Date,
    organizationId?: string,
    source?: string,
  ) {
    const from = dateFrom || new Date(new Date().setHours(0, 0, 0, 0));
    const to = dateTo || new Date();
    const orderWhere: any = {
      createdAt: { gte: from, lte: to },
      status: { not: 'CANCELLED' },
      ...(organizationId ? { contact: { organizationId } } : {}),
      ...(source ? { source } : {}),
    };
    const [
      summary,
      agents,
      collectionSeries,
      funnel,
      topCategories,
      ordersAgg,
      collectionRevenue,
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
      this.getCollectionTimeseries(from, to, organizationId, source).catch(() => []),
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
      this.getTopProductCategories(from, to, organizationId, 8, source),
      this.prisma.salesOrder.aggregate({ where: orderWhere, _count: { id: true }, _sum: { grandTotal: true } }).catch(() => ({
        _count: { id: 0 },
        _sum: { grandTotal: 0 },
      })),
      this.getCollectionRevenue(from, to, organizationId, source).catch(() => ({ total: 0, count: 0 })),
    ]);

    return {
      summary,
      agents,
      charts: {
        collections: collectionSeries,
        topCategories,
      },
      funnel,
      orders: {
        count: ordersAgg._count.id,
        sumGrandTotal: ordersAgg._sum.grandTotal ?? 0,
      },
      collectionRevenue,
    };
  }
}
