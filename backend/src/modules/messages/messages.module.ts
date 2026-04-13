import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { WahaModule } from '../waha/waha.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [WahaModule, ConversationsModule, WebsocketModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
