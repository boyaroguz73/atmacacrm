import { IsOptional, IsString, MinLength } from 'class-validator';

export class SendProductShareDto {
  @IsString()
  conversationId: string;

  @IsString()
  @MinLength(1)
  productId: string;

  /** Varyant seçimi — dolu ise varyantın görseli/fiyatı/kodu kullanılır. */
  @IsOptional()
  @IsString()
  productVariantId?: string;

  @IsOptional()
  @IsString()
  sessionName?: string;

  @IsOptional()
  @IsString()
  chatId?: string;
}
