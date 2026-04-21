import { Module } from '@nestjs/common';
import { CargoCompaniesService } from './cargo-companies.service';
import { CargoCompaniesController } from './cargo-companies.controller';

@Module({
  controllers: [CargoCompaniesController],
  providers: [CargoCompaniesService],
  exports: [CargoCompaniesService],
})
export class CargoCompaniesModule {}
