import { Module, forwardRef } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiEngineService } from './ai-engine.service';
import { AiLearningService } from './ai-learning.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WahaModule } from '../waha/waha.module';

@Module({
  imports: [PrismaModule, forwardRef(() => WahaModule)],
  controllers: [AiController],
  providers: [AiService, AiEngineService, AiLearningService],
  exports: [AiService, AiEngineService, AiLearningService],
})
export class AiModule {}
