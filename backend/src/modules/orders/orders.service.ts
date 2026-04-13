import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  private readonly includeRelations = {
    contact: { select: { id: true, name: true, surname: true, phone: true, email: true, company: true } },
    createdBy: { select: { id: true, name: true } },
    items: { include: { product: { select: { id: true, sku: true, name: true } } } },
    quote: { select: { id: true, quoteNumber: true } },
  };

  async findAll(params: { status?: OrderStatus; contactId?: string; page?: number; limit?: number }) {
    const { status, contactId, page = 1, limit = 50 } = params;
    const where: any = {};
    if (status) where.status = status;
    if (contactId) where.contactId = contactId;

    const [orders, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        include: this.includeRelations,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return { orders, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: this.includeRelations,
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    return order;
  }

  async create(userId: string, data: {
    contactId: string;
    currency?: string;
    shippingAddress?: string;
    notes?: string;
    items: { productId?: string; name: string; quantity: number; unitPrice: number; vatRate: number }[];
  }) {
    if (!data.items?.length) throw new BadRequestException('En az bir kalem gerekli');

    let subtotal = 0;
    let vatTotal = 0;
    const items = data.items.map((item) => {
      const base = item.quantity * item.unitPrice;
      const vat = base * (item.vatRate / 100);
      subtotal += base;
      vatTotal += vat;
      return { ...item, lineTotal: Math.round((base + vat) * 100) / 100 };
    });

    return this.prisma.salesOrder.create({
      data: {
        contactId: data.contactId,
        createdById: userId,
        currency: data.currency || 'TRY',
        subtotal: Math.round(subtotal * 100) / 100,
        vatTotal: Math.round(vatTotal * 100) / 100,
        grandTotal: Math.round((subtotal + vatTotal) * 100) / 100,
        shippingAddress: data.shippingAddress,
        notes: data.notes,
        items: {
          create: items.map((i) => ({
            productId: i.productId || null,
            name: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            vatRate: i.vatRate,
            lineTotal: i.lineTotal,
          })),
        },
      },
      include: this.includeRelations,
    });
  }

  async updateStatus(id: string, status: OrderStatus) {
    await this.findById(id);
    return this.prisma.salesOrder.update({
      where: { id },
      data: { status },
      include: this.includeRelations,
    });
  }
}
