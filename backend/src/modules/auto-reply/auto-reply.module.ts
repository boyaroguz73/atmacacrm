import { Module, forwardRef } from '@nestjs/common';
import { AutoReplyService } from './auto-reply.service';
import { AutoReplyController } from './auto-reply.controller';
import { AutoReplyEngineService } from './auto-reply-engine.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { WahaModule } from '../waha/waha.module';
import { LeadsModule } from '../leads/leads.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [AuditLogModule, forwardRef(() => WahaModule), LeadsModule, ConversationsModule],
  controllers: [AutoReplyController],
  providers: [AutoReplyService, AutoReplyEngineService],
  exports: [AutoReplyService, AutoReplyEngineService],
})
export class AutoReplyModule {}
