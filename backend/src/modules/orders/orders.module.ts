import { Module, forwardRef } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { EcommerceModule } from '../ecommerce/ecommerce.module';
import { WahaModule } from '../waha/waha.module';

@Module({
  imports: [forwardRef(() => EcommerceModule), forwardRef(() => WahaModule)],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
