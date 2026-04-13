import { Module, forwardRef } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { MessageSyncScheduler } from './message-sync.scheduler';
import { WahaModule } from '../waha/waha.module';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [forwardRef(() => WahaModule), forwardRef(() => ContactsModule)],
  controllers: [ConversationsController],
  providers: [ConversationsService, MessageSyncScheduler],
  exports: [ConversationsService],
})
export class ConversationsModule {}
