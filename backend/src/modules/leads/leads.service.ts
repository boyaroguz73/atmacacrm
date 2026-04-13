import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadStatus } from '@prisma/client';
import { TasksService } from '../tasks/tasks.service';

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private tasksService: TasksService,
  ) {}

  async create(
    data: {
      contactId: string;
      status?: LeadStatus;
      value?: number;
      source?: string;
      notes?: string;
    },
    organizationId?: string,
  ) {
    if (organizationId) {
      const contact = await this.prisma.contact.findUnique({
        where: { id: data.contactId },
        select: { organizationId: true },
      });
      if (contact?.organizationId !== organizationId) {
        throw new ForbiddenException('Bu kişi organizasyonunuza ait değil');
      }
    }

    return this.prisma.lead.create({
      data: {
        contactId: data.contactId,
        status: data.status || LeadStatus.NEW,
        value: data.value,
        source: data.source,
        notes: data.notes,
      },
      include: { contact: true },
    });
  }

  async findAll(params: {
    status?: LeadStatus;
    search?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    organizationId?: string;
  }) {
    const { status, search, from, to, page = 1, limit = 50, organizationId } = params;
    const where: any = {};

    if (status) where.status = status;

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const contactFilter: any = {};
    if (organizationId) contactFilter.organizationId = organizationId;
    if (search) {
      contactFilter.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }
    if (Object.keys(contactFilter).length > 0) {
      where.contact = contactFilter;
    }

    const [leads, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: { contact: true },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { leads, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        contact: { include: { conversations: true } },
        activities: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead bulunamadı');
    return lead;
  }

  async updateStatus(id: string, status: LeadStatus, userId: string) {
    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        status,
        closedAt:
          status === LeadStatus.WON || status === LeadStatus.LOST
            ? new Date()
            : null,
      },
      include: { contact: true },
    });

    const statusLabels: Record<string, string> = {
      NEW: 'Yeni',
      CONTACTED: 'İletişim Kuruldu',
      INTERESTED: 'İlgileniyor',
      OFFER_SENT: 'Teklif Gönderildi',
      WON: 'Kazanıldı',
      LOST: 'Kaybedildi',
    };

    await this.prisma.activity.create({
      data: {
        leadId: id,
        userId,
        type: 'STATUS_CHANGE',
        description: `Lead durumu "${statusLabels[status] || status}" olarak değiştirildi`,
      },
    });

    const followUpStatuses: LeadStatus[] = [
      LeadStatus.CONTACTED,
      LeadStatus.INTERESTED,
      LeadStatus.OFFER_SENT,
    ];

    if (followUpStatuses.includes(status)) {
      await this.tasksService.createFollowUpReminder({
        userId,
        contactId: lead.contactId,
        contactName: lead.contact.name || lead.contact.phone,
        trigger: status,
        delayHours: 24,
      });
    }

    return lead;
  }

  async update(
    id: string,
    data: { value?: number; source?: string; notes?: string },
  ) {
    return this.prisma.lead.update({
      where: { id },
      data,
      include: { contact: true },
    });
  }

  async getPipelineStats(organizationId?: string) {
    const leadWhere = organizationId
      ? { contact: { organizationId } }
      : {};

    const stats = await this.prisma.lead.groupBy({
      by: ['status'],
      where: leadWhere,
      _count: { id: true },
      _sum: { value: true },
    });

    return stats.map((s) => ({
      status: s.status,
      count: s._count.id,
      totalValue: s._sum.value || 0,
    }));
  }
}
