import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WahaModule } from '../waha/waha.module';
import { EcommerceController } from './ecommerce.controller';
import { EcommerceService } from './ecommerce.service';
import { TsoftApiService } from './tsoft-api.service';
import { TsoftSyncScheduler } from './tsoft-sync.scheduler';

@Module({
  imports: [PrismaModule, forwardRef(() => WahaModule)],
  controllers: [EcommerceController],
  providers: [EcommerceService, TsoftApiService, TsoftSyncScheduler],
  exports: [EcommerceService, TsoftApiService],
})
export class EcommerceModule {}
