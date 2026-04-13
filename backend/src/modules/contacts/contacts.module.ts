import { Module, forwardRef } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { WahaModule } from '../waha/waha.module';

@Module({
  imports: [forwardRef(() => WahaModule)],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
