import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class TemplatesService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async findAll(params?: {
    category?: string;
    isActive?: boolean;
    organizationId?: string;
  }) {
    const where: any = {};
    if (params?.category) where.category = params.category;
    if (params?.isActive !== undefined) where.isActive = params.isActive;
    if (params?.organizationId) where.organizationId = params.organizationId;

    return this.prisma.messageTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { creator: { select: { id: true, name: true } } },
    });
  }

  async findById(id: string) {
    const template = await this.prisma.messageTemplate.findUnique({
      where: { id },
      include: { creator: { select: { id: true, name: true } } },
    });
    if (!template) throw new NotFoundException('Şablon bulunamadı');
    return template;
  }

  async create(
    data: { title: string; body: string; category?: string; shortcut?: string },
    userId: string,
    organizationId?: string,
  ) {
    const template = await this.prisma.messageTemplate.create({
      data: {
        ...data,
        createdBy: userId,
        ...(organizationId ? { organizationId } : {}),
      },
      include: { creator: { select: { id: true, name: true } } },
    });

    await this.auditLog.log({
      userId,
      organizationId,
      action: 'CREATE',
      entity: 'MessageTemplate',
      entityId: template.id,
      details: { title: data.title },
    });

    return template;
  }

  async update(
    id: string,
    data: { title?: string; body?: string; category?: string; shortcut?: string; isActive?: boolean },
    userId: string,
  ) {
    await this.findById(id);
    const template = await this.prisma.messageTemplate.update({
      where: { id },
      data,
      include: { creator: { select: { id: true, name: true } } },
    });

    await this.auditLog.log({
      userId,
      action: 'UPDATE',
      entity: 'MessageTemplate',
      entityId: template.id,
      details: data,
    });

    return template;
  }

  async delete(id: string, userId: string) {
    await this.findById(id);

    await this.auditLog.log({
      userId,
      action: 'DELETE',
      entity: 'MessageTemplate',
      entityId: id,
    });

    return this.prisma.messageTemplate.delete({ where: { id } });
  }

  async getCategories(organizationId?: string) {
    const where: any = { category: { not: null } };
    if (organizationId) where.organizationId = organizationId;

    const result = await this.prisma.messageTemplate.findMany({
      where,
      select: { category: true },
      distinct: ['category'],
    });
    return result.map((r) => r.category).filter(Boolean);
  }
}
