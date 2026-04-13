import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as XLSX from 'xlsx';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(params: { search?: string; page?: number; limit?: number; isActive?: boolean }) {
    const { search, page = 1, limit = 50, isActive } = params;
    const where: any = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { products, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Ürün bulunamadı');
    return product;
  }

  async create(data: {
    sku: string;
    name: string;
    description?: string;
    unit?: string;
    unitPrice: number;
    currency?: string;
    vatRate?: number;
    stock?: number;
  }) {
    return this.prisma.product.create({ data });
  }

  async update(id: string, data: Partial<{
    sku: string;
    name: string;
    description: string;
    unit: string;
    unitPrice: number;
    currency: string;
    vatRate: number;
    stock: number;
    isActive: boolean;
  }>) {
    await this.findById(id);
    return this.prisma.product.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findById(id);
    return this.prisma.product.delete({ where: { id } });
  }

  async importExcel(buffer: Buffer): Promise<{ imported: number; updated: number; errors: string[] }> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new BadRequestException('Excel dosyasında sayfa bulunamadı');

    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
    let imported = 0;
    let updated = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const sku = String(row.SKU || row.sku || row['Stok Kodu'] || '').trim();
      const name = String(row.Name || row.name || row['Ürün Adı'] || row['Ad'] || '').trim();
      const unitPrice = parseFloat(row.Price || row.price || row['Fiyat'] || row.unitPrice || '0');

      if (!sku || !name) {
        errors.push(`Satır ${i + 2}: SKU veya ad eksik`);
        continue;
      }

      try {
        const result = await this.prisma.product.upsert({
          where: { sku },
          create: {
            sku,
            name,
            description: row.Description || row.description || row['Açıklama'] || undefined,
            unit: row.Unit || row.unit || row['Birim'] || 'Adet',
            unitPrice: isNaN(unitPrice) ? 0 : unitPrice,
            currency: row.Currency || row.currency || row['Para Birimi'] || 'TRY',
            vatRate: parseInt(row.VAT || row.vat || row['KDV'] || '20') || 20,
            stock: row.Stock != null ? parseInt(row.Stock || row.stock || row['Stok'] || '0') : undefined,
          },
          update: {
            name,
            description: row.Description || row.description || row['Açıklama'] || undefined,
            unitPrice: isNaN(unitPrice) ? undefined : unitPrice,
            currency: row.Currency || row.currency || row['Para Birimi'] || undefined,
            vatRate: row.VAT != null ? parseInt(row.VAT || row.vat || row['KDV'] || '20') : undefined,
            stock: row.Stock != null ? parseInt(row.Stock || row.stock || row['Stok'] || '0') : undefined,
          },
        });
        if (result.createdAt.getTime() === result.updatedAt.getTime()) imported++;
        else updated++;
      } catch (err: any) {
        errors.push(`Satır ${i + 2} (${sku}): ${err.message}`);
      }
    }

    this.logger.log(`Excel import: ${imported} yeni, ${updated} güncellendi, ${errors.length} hata`);
    return { imported, updated, errors };
  }
}
