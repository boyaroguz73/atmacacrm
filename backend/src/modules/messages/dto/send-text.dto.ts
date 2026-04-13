import { IsString, MinLength } from 'class-validator';

export class SendTextMessageDto {
  @IsString()
  conversationId: string;

  @IsString()
  sessionName: string;

  @IsString()
  chatId: string;

  @IsString()
  @MinLength(1, { message: 'Mesaj metni boş olamaz' })
  body: string;
}
