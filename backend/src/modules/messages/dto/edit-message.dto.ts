import { IsString, MinLength } from 'class-validator';

export class EditMessageDto {
  @IsString()
  sessionName: string;

  @IsString()
  chatId: string;

  @IsString()
  @MinLength(1, { message: 'Yeni metin boş olamaz' })
  newBody: string;
}
