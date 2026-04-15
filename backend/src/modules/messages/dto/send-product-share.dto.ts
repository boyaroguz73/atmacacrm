import { IsOptional, IsString, MinLength } from 'class-validator';

export class SendProductShareDto {
  @IsString()
  conversationId: string;

  @IsString()
  @MinLength(1)
  productId: string;

  @IsOptional()
  @IsString()
  sessionName?: string;

  @IsOptional()
  @IsString()
  chatId?: string;
}
