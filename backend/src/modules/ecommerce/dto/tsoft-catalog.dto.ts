import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateTsoftCatalogDto {
  @IsString()
  @MinLength(1)
  productCode!: string;

  @IsString()
  @MinLength(1)
  productName!: string;

  @Type(() => Number)
  @IsNumber()
  sellingPrice!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  stock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vatRate?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsOptional()
  @IsString()
  detailsText?: string;
}

export class UpdateTsoftCatalogDto {
  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sellingPrice?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  listPrice?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  stock?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  vatRate?: number | null;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  shortDescription?: string | null;

  @IsOptional()
  @IsString()
  detailsText?: string | null;

  @IsOptional()
  @IsString()
  brand?: string | null;

  @IsOptional()
  @IsString()
  barcode?: string | null;

  /** false ise yalnızca CRM kaydı güncellenir (isteğe bağlı) */
  @IsOptional()
  @IsBoolean()
  pushToSite?: boolean;
}

export class DeleteSiteOrderDto {
  @Type(() => Number)
  @IsNumber()
  orderId!: number;
}

export class SetSiteOrderStatusDto {
  @Type(() => Number)
  @IsNumber()
  orderNumericId!: number;

  @IsString()
  orderStatusId!: string;
}

export class PushSalesOrderToTsoftDto {
  @IsString()
  @MinLength(1)
  salesOrderId!: string;
}

export class SetCrmLinkedSiteOrderStatusDto {
  @IsString()
  @MinLength(1)
  orderStatusId!: string;
}
