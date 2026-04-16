import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SuppliersService {
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
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [suppliers, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return { suppliers, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        orderItems: {
          include: {
            order: {
              select: { id: true, orderNumber: true, status: true, createdAt: true },
            },
          },
          orderBy: { order: { createdAt: 'desc' } },
          take: 20,
        },
      },
    });
    if (!supplier) throw new NotFoundException('Tedarikçi bulunamadı');
    return supplier;
  }

  async create(data: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    notes?: string;
    isActive?: boolean;
  }) {
    return this.prisma.supplier.create({
      data: {
        name: data.name,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        address: data.address?.trim() || null,
        notes: data.notes?.trim() || null,
        isActive: data.isActive ?? true,
      },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      phone?: string;
      email?: string;
      address?: string;
      notes?: string;
      isActive?: boolean;
    },
  ) {
    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tedarikçi bulunamadı');

    return this.prisma.supplier.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.phone !== undefined && { phone: data.phone?.trim() || null }),
        ...(data.email !== undefined && { email: data.email?.trim() || null }),
        ...(data.address !== undefined && { address: data.address?.trim() || null }),
        ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tedarikçi bulunamadı');

    await this.prisma.supplier.delete({ where: { id } });
    return { deleted: true };
  }
}
