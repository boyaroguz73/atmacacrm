import { Module } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { QuotesController } from './quotes.controller';
import { QuoteDepositReminderScheduler } from './quote-deposit-reminder.scheduler';
import { WahaModule } from '../waha/waha.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [WahaModule, TasksModule],
  controllers: [QuotesController],
  providers: [QuotesService, QuoteDepositReminderScheduler],
  exports: [QuotesService],
})
export class QuotesModule {}
