import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EcommerceService } from './ecommerce.service';

@Injectable()
export class TsoftSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(TsoftSyncScheduler.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private ecommerceService: EcommerceService,
  ) {}

  async onModuleInit() {
    setTimeout(() => this.run().catch(() => {}), 30_000);
  }

  @Cron('0 */30 * * * *')
  async runScheduled() {
    if (this.running) {
      this.logger.warn('Önceki T-Soft sync hâlâ çalışıyor, bu tur atlandı.');
      return;
    }
    await this.run();
  }

  private async run() {
    this.running = true;
    try {
      const integrations = await this.prisma.orgIntegration.findMany({
        where: { integrationKey: 'tsoft', isEnabled: true },
        select: { organizationId: true },
      });

      for (const { organizationId } of integrations) {
        try {
          const r = await this.ecommerceService.syncTsoftOrders(organizationId);
          this.logger.log(
            `T-Soft sync [${organizationId}]: ${r.created} yeni, ${r.updated} güncellendi, ${r.autoRepliesSent} yanıt`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`T-Soft sync başarısız [${organizationId}]: ${msg}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
