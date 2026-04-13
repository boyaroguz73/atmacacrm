import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { PLAN_CONFIGS, getPlanConfig, PlanConfig } from './plan-config';
import { PlanType, SubscriptionStatus } from '@prisma/client';

/** setDate / ms taşması olmadan güvenli üst sınır (~100 yıl, fiilen süresiz sayılır) */
export const MAX_ASSIGN_PLAN_DURATION_DAYS = 36_500;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private iyzipay: any;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const Iyzipay = require('iyzipay');
    const apiKey = this.config.get('IYZICO_API_KEY');
    const secretKey = this.config.get('IYZICO_SECRET_KEY');
    const uri = this.config.get('IYZICO_BASE_URL', 'https://sandbox-api.iyzipay.com');

    if (apiKey && secretKey) {
      this.iyzipay = new Iyzipay({ apiKey, secretKey, uri });
      this.logger.log('Iyzico initialized');
    } else {
      this.logger.warn('Iyzico credentials not configured - payment disabled');
    }
  }

  getPlans() {
    return Object.entries(PLAN_CONFIGS).map(([key, config]) => ({
      key,
      id: key,
      ...config,
    }));
  }

  async getSubscription(organizationId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { organizationId, status: { in: ['ACTIVE', 'TRIALING'] } },
      orderBy: { createdAt: 'desc' },
    });

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, maxUsers: true, maxSessions: true },
    });

    return {
      subscription: sub,
      currentPlan: org?.plan || 'FREE',
      planConfig: getPlanConfig(org?.plan || 'FREE'),
      limits: { maxUsers: org?.maxUsers, maxSessions: org?.maxSessions },
    };
  }

  async getInvoices(organizationId: string) {
    return this.prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async initializePayment(
    organizationId: string,
    planKey: string,
    cardData: {
      cardHolderName: string;
      cardNumber: string;
      expireMonth: string;
      expireYear: string;
      cvc: string;
    },
    buyer: {
      name: string;
      surname: string;
      email: string;
      phone: string;
      identityNumber: string;
      address: string;
      city: string;
      country?: string;
    },
  ) {
    const plan = PLAN_CONFIGS[planKey];
    if (!plan) throw new BadRequestException('Geçersiz plan');
    if (!this.iyzipay) throw new BadRequestException('Ödeme sistemi yapılandırılmamış');

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');

    const conversationId = `sub_${organizationId}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const request = {
        locale: 'tr',
        conversationId,
        price: plan.price.toString(),
        paidPrice: plan.price.toString(),
        currency: 'TRY',
        installment: '1',
        basketId: `plan_${planKey}_${organizationId}`,
        paymentChannel: 'WEB',
        paymentGroup: 'SUBSCRIPTION',
        paymentCard: {
          cardHolderName: cardData.cardHolderName,
          cardNumber: cardData.cardNumber,
          expireMonth: cardData.expireMonth,
          expireYear: cardData.expireYear,
          cvc: cardData.cvc,
          registerCard: '0',
        },
        buyer: {
          id: organizationId,
          name: buyer.name,
          surname: buyer.surname,
          gsmNumber: buyer.phone,
          email: buyer.email,
          identityNumber: buyer.identityNumber,
          registrationAddress: buyer.address,
          ip: '0.0.0.0',
          city: buyer.city,
          country: buyer.country || 'Turkey',
        },
        shippingAddress: {
          contactName: `${buyer.name} ${buyer.surname}`,
          city: buyer.city,
          country: buyer.country || 'Turkey',
          address: buyer.address,
        },
        billingAddress: {
          contactName: `${buyer.name} ${buyer.surname}`,
          city: buyer.city,
          country: buyer.country || 'Turkey',
          address: buyer.address,
        },
        basketItems: [
          {
            id: planKey,
            name: `${plan.name} Plan - Aylık Abonelik`,
            category1: 'SaaS Subscription',
            itemType: 'VIRTUAL',
            price: plan.price.toString(),
          },
        ],
      };

      this.iyzipay.payment.create(request, async (err: any, result: any) => {
        if (err) {
          this.logger.error('Iyzico error:', err);
          reject(new BadRequestException('Ödeme işlemi başarısız'));
          return;
        }

        if (result.status !== 'success') {
          this.logger.warn('Iyzico payment failed:', result.errorMessage);
          reject(new BadRequestException(result.errorMessage || 'Ödeme reddedildi'));
          return;
        }

        try {
          await this.activateSubscription(organizationId, planKey as PlanType, result.paymentId);
          resolve({ success: true, paymentId: result.paymentId });
        } catch (e: any) {
          reject(new BadRequestException(e.message));
        }
      });
    });
  }

  async activateSubscription(organizationId: string, plan: PlanType, paymentId?: string) {
    const planConfig = getPlanConfig(plan);

    await this.prisma.subscription.updateMany({
      where: { organizationId, status: { in: ['ACTIVE', 'TRIALING'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const subscription = await this.prisma.subscription.create({
      data: {
        organizationId,
        plan,
        status: 'ACTIVE',
        priceMonthly: planConfig.price,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        iyzicoSubRef: paymentId,
      },
    });

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        plan,
        maxUsers: planConfig.maxUsers,
        maxSessions: planConfig.maxSessions,
      },
    });

    if (paymentId) {
      await this.prisma.invoice.create({
        data: {
          organizationId,
          subscriptionId: subscription.id,
          amount: planConfig.price,
          status: 'paid',
          iyzicoPaymentId: paymentId,
          description: `${planConfig.name} Plan - Aylık Abonelik`,
          paidAt: now,
        },
      });
    }

    this.logger.log(`Subscription activated: org=${organizationId} plan=${plan}`);
    return subscription;
  }

  async cancelSubscription(organizationId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { organizationId, status: 'ACTIVE' },
    });
    if (!sub) throw new NotFoundException('Aktif abonelik bulunamadı');

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { plan: 'FREE', maxUsers: 2, maxSessions: 1 },
    });

    return { message: 'Abonelik iptal edildi. Dönem sonuna kadar mevcut özellikler aktif.' };
  }

  // SuperAdmin: plan yapılandırmalarını getir (DB'den veya statik)
  async getPlanConfigs() {
    const dbConfigs = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: 'plan_config_' } },
    });

    const result: Record<string, any> = {};
    for (const [key, config] of Object.entries(PLAN_CONFIGS)) {
      const dbEntry = dbConfigs.find((s) => s.key === `plan_config_${key}`);
      if (dbEntry) {
        try {
          result[key] = { id: key, ...JSON.parse(dbEntry.value) };
        } catch {
          result[key] = { id: key, ...config };
        }
      } else {
        result[key] = { id: key, ...config };
      }
    }
    return Object.values(result);
  }

  // SuperAdmin: plan yapılandırmasını güncelle
  async updatePlanConfig(planKey: string, updates: Partial<PlanConfig>) {
    const existing = PLAN_CONFIGS[planKey];
    if (!existing) throw new NotFoundException('Plan bulunamadı');

    const dbKey = `plan_config_${planKey}`;
    const dbEntry = await this.prisma.systemSetting.findUnique({
      where: { key: dbKey },
    });

    let current: any = { ...existing };
    if (dbEntry) {
      try { current = JSON.parse(dbEntry.value); } catch { /* use default */ }
    }

    const merged = {
      ...current,
      ...updates,
      featureFlags: {
        ...(current.featureFlags || {}),
        ...(updates.featureFlags || {}),
      },
    };

    await this.prisma.systemSetting.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: JSON.stringify(merged) },
      update: { value: JSON.stringify(merged) },
    });

    return { id: planKey, ...merged };
  }

  // SuperAdmin: bir organizasyona belirli süreyle plan ata
  async assignPlan(data: {
    organizationId: string;
    plan: PlanType;
    durationDays: number;
    assignedById: string;
    notes?: string;
  }) {
    let durationDays = Math.max(1, Math.floor(Number(data.durationDays)) || 30);
    if (durationDays > MAX_ASSIGN_PLAN_DURATION_DAYS) {
      throw new BadRequestException(
        `Süre en fazla ${MAX_ASSIGN_PLAN_DURATION_DAYS.toLocaleString('tr-TR')} gün olabilir (yaklaşık 100 yıl). Daha uzun süre pratikte süresiz abonelik anlamına gelir.`,
      );
    }
    const planKey = String(data.plan || '').toUpperCase();
    if (!PLAN_CONFIGS[planKey]) {
      throw new BadRequestException('Geçersiz plan');
    }
    const plan = planKey as PlanType;

    const orgId = String(data.organizationId ?? '').trim();
    if (!orgId) {
      throw new BadRequestException('Organizasyon kimliği gerekli');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');

    const planConfig = getPlanConfig(plan);

    await this.prisma.subscription.updateMany({
      where: { organizationId: orgId, status: { in: ['ACTIVE', 'TRIALING'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    const now = new Date();
    const periodEnd = new Date(now.getTime() + durationDays * 86_400_000);
    if (!Number.isFinite(periodEnd.getTime())) {
      throw new BadRequestException('Hesaplanan bitiş tarihi geçersiz; süre çok büyük olabilir.');
    }

    const subscription = await this.prisma.subscription.create({
      data: {
        organizationId: orgId,
        plan,
        status: 'ACTIVE',
        priceMonthly: 0,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    });

    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        plan,
        maxUsers: planConfig.maxUsers,
        maxSessions: planConfig.maxSessions,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: data.assignedById,
        action: 'ASSIGN_PLAN',
        entity: 'Organization',
        entityId: orgId,
        details: {
          plan,
          durationDays,
          notes: data.notes,
          periodEnd: periodEnd.toISOString(),
        },
      },
    });

    this.logger.log(
      `Plan assigned: org=${orgId} plan=${plan} days=${durationDays}`,
    );

    return { subscription, organization: org.name, plan, expiresAt: periodEnd };
  }

  // SuperAdmin: tüm gelirleri göster
  async getRevenueStats() {
    const totalRevenue = await this.prisma.invoice.aggregate({
      where: { status: 'paid' },
      _sum: { amount: true },
      _count: true,
    });

    const monthlyRevenue = (await this.prisma.$queryRaw`
      SELECT
        DATE_TRUNC('month', "paidAt") as month,
        SUM(amount)::float as revenue,
        COUNT(*)::int as count
      FROM invoices
      WHERE status = 'paid' AND "paidAt" IS NOT NULL
      GROUP BY DATE_TRUNC('month', "paidAt")
      ORDER BY month DESC
      LIMIT 12
    `) as { month: Date; revenue: number; count: number }[];

    const planBreakdown = await this.prisma.subscription.groupBy({
      by: ['plan', 'status'],
      _count: true,
    });

    const monthly = monthlyRevenue.map((row) => ({
      month: row.month instanceof Date ? row.month.toISOString() : row.month,
      revenue: Number(row.revenue ?? 0),
      count: Number(row.count ?? 0),
    }));

    return {
      total: Number(totalRevenue._sum.amount ?? 0),
      invoiceCount: totalRevenue._count ?? 0,
      monthly,
      planBreakdown,
    };
  }
}
