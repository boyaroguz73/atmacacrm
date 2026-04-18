import { IsBoolean, IsIn, IsString } from 'class-validator';
import { TSOFT_AUTO_REPLY_EVENTS } from '../ecommerce.service';

export class SaveTsoftAutoReplyDto {
  @IsIn(TSOFT_AUTO_REPLY_EVENTS as unknown as string[])
  eventType!: string;

  @IsString()
  template!: string;

  @IsBoolean()
  isActive!: boolean;
}
