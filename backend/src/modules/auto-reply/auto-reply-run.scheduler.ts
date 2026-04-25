import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AutoReplyEngineService } from './auto-reply-engine.service';

@Injectable()
export class AutoReplyRunScheduler {
  private readonly logger = new Logger(AutoReplyRunScheduler.name);

  constructor(private readonly engine: AutoReplyEngineService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'auto-reply-runs' })
  async drainRuns() {
    try {
      const queued = await this.engine.enqueueDeliveryDateBasedRuns();
      if (queued > 0) {
        this.logger.debug(`Teslim tarihi bazlı automation run kuyruğa alındı: ${queued}`);
      }
      const count = await this.engine.runPendingRuns(50);
      if (count > 0) {
        this.logger.debug(`Automation run işlendi: ${count}`);
      }
    } catch (e: any) {
      this.logger.warn(`Automation run scheduler hatası: ${e?.message || e}`);
    }
  }
}
