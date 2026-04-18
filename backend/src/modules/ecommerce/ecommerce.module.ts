import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { EcommerceController } from './ecommerce.controller';
import { EcommerceService } from './ecommerce.service';
import { TsoftApiService } from './tsoft-api.service';

@Module({
  imports: [PrismaModule, forwardRef(() => OrdersModule)],
  controllers: [EcommerceController],
  providers: [EcommerceService, TsoftApiService],
  exports: [EcommerceService, TsoftApiService],
})
export class EcommerceModule {}
