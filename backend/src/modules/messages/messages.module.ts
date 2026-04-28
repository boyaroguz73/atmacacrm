import { Module, forwardRef } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { WahaModule } from '../waha/waha.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    forwardRef(() => WahaModule),
    forwardRef(() => ConversationsModule),
    WebsocketModule,
    ProductsModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
