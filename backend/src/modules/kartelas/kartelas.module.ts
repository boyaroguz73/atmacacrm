import { Module } from '@nestjs/common';
import { KartelasController } from './kartelas.controller';
import { KartelasService } from './kartelas.service';

@Module({
  controllers: [KartelasController],
  providers: [KartelasService],
  exports: [KartelasService],
})
export class KartelasModule {}
