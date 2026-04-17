import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private prisma: PrismaService) {}

  async log(params: {
    userId?: string;
    organizationId?: string;
    action: string;
    entity: string;
    entityId?: string;
    details?: any;
    ipAddress?: string;
  }) {
    try {
      return await this.prisma.auditLog.create({ data: params });
    } catch (err: any) {
      this.logger.error(`Audit log yazılamadı: ${err.message}`);
    }
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    userId?: string;
    entity?: string;
    action?: string;
    search?: string;
    scope?: string;
    startDate?: string;
    endDate?: string;
    organizationId?: string;
  }) {
    const {
      page = 1,
      limit = 50,
      userId,
      entity,
      action,
      search,
      scope,
      startDate,
      endDate,
      organizationId,
    } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (organizationId) where.organizationId = organizationId;
    if (userId) where.userId = userId;
    if (entity) where.entity = entity;
    if (action) where.action = action;
    if (scope === 'process') {
      where.entity = {
        in: ['Contact', 'Conversation', 'Lead', 'Task', 'Assignment', 'Quote', 'SalesOrder'],
      };
    }
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { action: { contains: q, mode: 'insensitive' } },
        { entity: { contains: q, mode: 'insensitive' } },
        { entityId: { contains: q, mode: 'insensitive' } },
        { ipAddress: { contains: q, mode: 'insensitive' } },
        { user: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { id: true, name: true, role: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getEntities(organizationId?: string) {
    const where: any = {};
    if (organizationId) where.organizationId = organizationId;

    const result = await this.prisma.auditLog.findMany({
      where,
      select: { entity: true },
      distinct: ['entity'],
    });
    return result.map((r) => r.entity);
  }

  async getActions(organizationId?: string) {
    const where: any = {};
    if (organizationId) where.organizationId = organizationId;

    const result = await this.prisma.auditLog.findMany({
      where,
      select: { action: true },
      distinct: ['action'],
    });
    return result.map((r) => r.action);
  }
}
