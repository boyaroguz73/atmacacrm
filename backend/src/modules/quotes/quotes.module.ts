import { Module } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { QuotesController } from './quotes.controller';
import { QuoteDepositReminderScheduler } from './quote-deposit-reminder.scheduler';
import { WahaModule } from '../waha/waha.module';
import { TasksModule } from '../tasks/tasks.module';
import { AutoReplyModule } from '../auto-reply/auto-reply.module';

@Module({
  imports: [WahaModule, TasksModule, AutoReplyModule],
  controllers: [QuotesController],
  providers: [QuotesService, QuoteDepositReminderScheduler],
  exports: [QuotesService],
})
export class QuotesModule {}
