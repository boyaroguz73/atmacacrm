import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductCategoriesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.productCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(data: { name: string; description?: string | null; sortOrder?: number }) {
    const name = String(data.name || '').trim();
    if (!name) throw new ConflictException('Kategori adı gerekli');
    try {
      return await this.prisma.productCategory.create({
        data: {
          name,
          description: data.description == null ? null : String(data.description),
          sortOrder: data.sortOrder ?? 0,
        },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('Bu isimde kategori var');
      throw e;
    }
  }

  async update(
    id: string,
    data: { name?: string; description?: string | null; sortOrder?: number },
  ) {
    await this.findById(id);
    const patch: { name?: string; description?: string | null; sortOrder?: number } = {};
    if (data.name != null) patch.name = String(data.name).trim();
    if ('description' in data) patch.description = data.description == null ? null : String(data.description);
    if (data.sortOrder != null) patch.sortOrder = data.sortOrder;
    try {
      return await this.prisma.productCategory.update({ where: { id }, data: patch });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('Bu isimde kategori var');
      throw e;
    }
  }

  async remove(id: string) {
    await this.findById(id);
    return this.prisma.productCategory.delete({ where: { id } });
  }

  async findById(id: string) {
    const row = await this.prisma.productCategory.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Kategori bulunamadı');
    return row;
  }
}
