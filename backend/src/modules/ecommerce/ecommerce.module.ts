import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EcommerceController } from './ecommerce.controller';
import { EcommerceService } from './ecommerce.service';
import { TsoftApiService } from './tsoft-api.service';

@Module({
  imports: [PrismaModule],
  controllers: [EcommerceController],
  providers: [EcommerceService, TsoftApiService],
  exports: [EcommerceService, TsoftApiService],
})
export class EcommerceModule {}
