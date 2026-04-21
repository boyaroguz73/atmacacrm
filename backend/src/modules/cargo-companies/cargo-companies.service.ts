import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CargoCompaniesService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: { search?: string; page?: number; limit?: number; isActive?: boolean }) {
    const { search, page = 1, limit = 50, isActive } = params;
    const where: any = {};

    if (typeof isActive === 'boolean') {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const [cargoCompanies, total] = await Promise.all([
      this.prisma.cargoCompany.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cargoCompany.count({ where }),
    ]);

    return { cargoCompanies, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const company = await this.prisma.cargoCompany.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('Kargo firması bulunamadı');
    return company;
  }

  async create(data: {
    name: string;
    isAmbar?: boolean;
    phone?: string;
    notes?: string;
    isActive?: boolean;
  }) {
    return this.prisma.cargoCompany.create({
      data: {
        name: data.name,
        isAmbar: data.isAmbar ?? false,
        phone: data.phone?.trim() || null,
        notes: data.notes?.trim() || null,
        isActive: data.isActive ?? true,
      },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      isAmbar?: boolean;
      phone?: string;
      notes?: string;
      isActive?: boolean;
    },
  ) {
    const existing = await this.prisma.cargoCompany.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Kargo firması bulunamadı');

    return this.prisma.cargoCompany.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.isAmbar !== undefined && { isAmbar: data.isAmbar }),
        ...(data.phone !== undefined && { phone: data.phone?.trim() || null }),
        ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.cargoCompany.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Kargo firması bulunamadı');
    await this.prisma.cargoCompany.delete({ where: { id } });
    return { deleted: true };
  }
}
