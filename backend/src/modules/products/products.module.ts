import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductFeedScheduler } from './product-feed.scheduler';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductFeedScheduler],
  exports: [ProductsService],
})
export class ProductsModule {}
