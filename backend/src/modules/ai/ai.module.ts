import { Module, forwardRef } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiEngineService } from './ai-engine.service';
import { AiLearningService } from './ai-learning.service';
import { AiIntentRouterService } from './ai-intent-router.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WahaModule } from '../waha/waha.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [PrismaModule, forwardRef(() => WahaModule), MessagesModule],
  controllers: [AiController],
  providers: [AiService, AiEngineService, AiLearningService, AiIntentRouterService],
  exports: [AiService, AiEngineService, AiLearningService, AiIntentRouterService],
})
export class AiModule {}
