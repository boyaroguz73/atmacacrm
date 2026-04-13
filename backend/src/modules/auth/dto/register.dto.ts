import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'Şirketim A.Ş.' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  organizationName: string;

  @ApiProperty({ example: 'user@company.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Ahmet Yılmaz' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;
}
