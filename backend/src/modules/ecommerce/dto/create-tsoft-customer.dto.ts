import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTsoftCustomerDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Şifre en az 8 karakter olmalı (T-Soft gereksinimi)' })
  password!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  surname!: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  cityCode?: string;

  @IsOptional()
  @IsString()
  districtCode?: string;

  @IsOptional()
  @IsString()
  provinceCode?: string;

  @IsOptional()
  @IsString()
  townCode?: string;

  @IsOptional()
  @IsString()
  company?: string;
}
