import { Module, forwardRef } from '@nestjs/common';
import { WahaService } from './waha.service';
import { WahaWebhookController } from './waha-webhook.controller';
import { WahaSessionController } from './waha-session.controller';
import { WahaFilesController } from './waha-files.controller';
import { WahaWebhookHandler } from './waha-webhook.handler';
import { ContactsModule } from '../contacts/contacts.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { AutoReplyModule } from '../auto-reply/auto-reply.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    forwardRef(() => ContactsModule),
    forwardRef(() => ConversationsModule),
    forwardRef(() => WebsocketModule),
    forwardRef(() => AutoReplyModule),
    forwardRef(() => AiModule),
  ],
  controllers: [WahaWebhookController, WahaSessionController, WahaFilesController],
  providers: [WahaService, WahaWebhookHandler],
  exports: [WahaService],
})
export class WahaModule {}
