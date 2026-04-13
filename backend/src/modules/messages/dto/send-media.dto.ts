import { IsOptional, IsString, MinLength } from 'class-validator';

export class SendMediaMessageDto {
  @IsString()
  conversationId: string;

  @IsString()
  sessionName: string;

  @IsString()
  chatId: string;

  @IsString()
  @MinLength(1)
  mediaUrl: string;

  @IsOptional()
  @IsString()
  caption?: string;
}
