import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaskStatus } from '@prisma/client';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    userId: string;
    contactId?: string;
    title: string;
    description?: string;
    dueAt: Date;
    trigger?: string;
  }) {
    return this.prisma.task.create({
      data,
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        user: { select: { id: true, name: true } },
      },
    });
  }

  async createFollowUpReminder(params: {
    userId: string;
    contactId: string;
    contactName: string;
    trigger: string;
    delayHours?: number;
  }) {
    const { userId, contactId, contactName, trigger, delayHours = 24 } = params;

    const dueAt = new Date();
    dueAt.setHours(dueAt.getHours() + delayHours);

    const triggerLabels: Record<string, string> = {
      CONTACTED: 'İletişim kuruldu',
      INTERESTED: 'İlgileniyor',
      OFFER_SENT: 'Teklif gönderildi',
    };
    const triggerLabel = triggerLabels[trigger] || trigger;

    return this.create({
      userId,
      contactId,
      title: `${contactName} kişisine dönüş yap`,
      description: `"${triggerLabel}" olarak etiketlendi. Takip mesajı gönder.`,
      dueAt,
      trigger,
    });
  }

  async findByUser(
    userId: string,
    params: { status?: TaskStatus; from?: string; to?: string; page?: number; limit?: number },
  ) {
    const { status, from, to, page = 1, limit = 50 } = params;
    const where: any = { userId };
    if (status) where.status = status;
    if (from || to) {
      where.dueAt = {};
      if (from) where.dueAt.gte = new Date(from);
      if (to) where.dueAt.lte = new Date(to);
    }

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: {
          contact: { select: { id: true, name: true, phone: true } },
        },
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.task.count({ where }),
    ]);

    return { tasks, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findAll(params: {
    status?: TaskStatus;
    userId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    organizationId?: string;
  }) {
    const { status, userId, from, to, page = 1, limit = 50, organizationId } = params;
    const where: any = {};
    if (organizationId) where.user = { organizationId };
    if (status) where.status = status;
    if (userId) where.userId = userId;
    if (from || to) {
      where.dueAt = {};
      if (from) where.dueAt.gte = new Date(from);
      if (to) where.dueAt.lte = new Date(to);
    }

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: {
          contact: { select: { id: true, name: true, phone: true } },
          user: { select: { id: true, name: true } },
        },
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.task.count({ where }),
    ]);

    return { tasks, total, page, totalPages: Math.ceil(total / limit) };
  }

  async getDueTasks(organizationId?: string) {
    return this.prisma.task.findMany({
      where: {
        status: TaskStatus.PENDING,
        dueAt: { lte: new Date() },
        ...(organizationId ? { user: { organizationId } } : {}),
      },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { dueAt: 'asc' },
    });
  }

  async complete(id: string, userId?: string, userRole?: string) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Görev bulunamadı');
    if (userId && userRole !== 'SUPERADMIN' && userRole !== 'ADMIN' && task.userId !== userId) {
      throw new ForbiddenException('Bu göreve erişim yetkiniz yok');
    }
    return this.prisma.task.update({
      where: { id },
      data: { status: TaskStatus.COMPLETED, completedAt: new Date() },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
      },
    });
  }

  async cancel(id: string, userId?: string, userRole?: string) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Görev bulunamadı');
    if (userId && userRole !== 'SUPERADMIN' && userRole !== 'ADMIN' && task.userId !== userId) {
      throw new ForbiddenException('Bu göreve erişim yetkiniz yok');
    }
    return this.prisma.task.update({
      where: { id },
      data: { status: TaskStatus.CANCELLED },
    });
  }

  async getStats(userId?: string, organizationId?: string) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (organizationId) where.user = { ...where.user, organizationId };

    const [pending, overdue, completedToday] = await Promise.all([
      this.prisma.task.count({
        where: { ...where, status: TaskStatus.PENDING },
      }),
      this.prisma.task.count({
        where: {
          ...where,
          status: TaskStatus.PENDING,
          dueAt: { lte: new Date() },
        },
      }),
      this.prisma.task.count({
        where: {
          ...where,
          status: TaskStatus.COMPLETED,
          completedAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
    ]);

    return { pending, overdue, completedToday };
  }
}
