import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { QuotePaymentMode } from '@prisma/client';
import { SettingsService } from '../settings/settings.service';

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** %50 ön ödemede, teslimden 1 gün önce muhasebeciye kalan tahsilat görevi. */
@Injectable()
export class QuoteDepositReminderScheduler {
  private readonly logger = new Logger(QuoteDepositReminderScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly settingsService: SettingsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async run(): Promise<void> {
    const enabled = (await this.settingsService.get('auto_task_quote_deposit_balance')) !== 'false';
    if (!enabled) return;

    const today = startOfLocalDay(new Date());

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        depositBalanceReminderSent: false,
        expectedDeliveryDate: { not: null },
        quote: { paymentMode: QuotePaymentMode.DEPOSIT_50 },
      },
      include: {
        quote: { select: { quoteNumber: true, paymentMode: true, grandTotal: true } },
        contact: { select: { id: true, organizationId: true, name: true, surname: true, phone: true } },
      },
    });

    for (const o of orders) {
      if (!o.expectedDeliveryDate) continue;
      const deliveryDay = startOfLocalDay(o.expectedDeliveryDate);
      const diffDays = Math.round((deliveryDay.getTime() - today.getTime()) / 86400000);
      if (diffDays !== 1) continue;

      let assigneeId = o.createdById;
      const orgId = o.contact.organizationId;
      if (orgId) {
        const acc = await this.prisma.user.findFirst({
          where: { organizationId: orgId, role: 'ACCOUNTANT', isActive: true },
          orderBy: { createdAt: 'asc' },
        });
        if (acc) assigneeId = acc.id;
      } else {
        const acc = await this.prisma.user.findFirst({
          where: { role: 'ACCOUNTANT', isActive: true },
          orderBy: { createdAt: 'asc' },
        });
        if (acc) assigneeId = acc.id;
      }

      const contactLabel =
        [o.contact.name, o.contact.surname].filter(Boolean).join(' ') || o.contact.phone;
      const deliveryStr = deliveryDay.toLocaleDateString('tr-TR');

      try {
        await this.tasksService.create({
          userId: assigneeId,
          contactId: o.contactId,
          title: `Kalan tahsilat — Sipariş #${o.orderNumber} (teslim ${deliveryStr})`,
          description:
            `Ön ödemeli teklif TKL-${String(o.quote?.quoteNumber ?? 0).padStart(5, '0')}. ` +
            `${contactLabel} — teslim öncesi kalan bakiyeyi tahsil edin.`,
          dueAt: new Date(),
          trigger: 'DEPOSIT_BALANCE_BEFORE_DELIVERY',
        });
        await this.prisma.salesOrder.update({
          where: { id: o.id },
          data: { depositBalanceReminderSent: true },
        });
        this.logger.log(`Teslim öncesi tahsilat görevi: sipariş ${o.orderNumber}`);
      } catch (e: any) {
        this.logger.error(`Sipariş ${o.id} hatırlatması oluşturulamadı: ${e?.message}`);
      }
    }
  }
}
