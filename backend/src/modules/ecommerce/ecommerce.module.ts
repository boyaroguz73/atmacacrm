import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { EcommerceController } from './ecommerce.controller';
import { EcommerceService } from './ecommerce.service';
import { TsoftApiService } from './tsoft-api.service';
import { TsoftProductSyncService } from './tsoft-product-sync.service';
import { TsoftPushService } from './tsoft-push.service';
import { TsoftSyncScheduler } from './tsoft-sync.scheduler';
import { AutoReplyModule } from '../auto-reply/auto-reply.module';

@Module({
  imports: [PrismaModule, forwardRef(() => OrdersModule), AutoReplyModule],
  controllers: [EcommerceController],
  providers: [
    EcommerceService,
    TsoftApiService,
    TsoftProductSyncService,
    TsoftPushService,
    TsoftSyncScheduler,
  ],
  exports: [
    EcommerceService,
    TsoftApiService,
    TsoftProductSyncService,
    TsoftPushService,
  ],
})
export class EcommerceModule {}
