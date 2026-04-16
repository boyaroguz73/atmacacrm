import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadStatus } from '@prisma/client';
import { TasksService } from '../tasks/tasks.service';
import { assertLeadStatusTransition } from '../../common/lead-status-transitions';

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private tasksService: TasksService,
  ) {}

  private readonly statusLabels: Record<string, string> = {
    NEW: 'Yeni',
    CONTACTED: 'İletişim Kuruldu',
    INTERESTED: 'İlgileniyor',
    OFFER_SENT: 'Teklif Gönderildi',
    WON: 'Kazanıldı',
    LOST: 'Kaybedildi',
  };

  /** Otomasyon kayıtları için: org’da ilk aktif yönetici (aktivite atanı) */
  async resolveAutomationActingUserId(organizationId: string | null | undefined): Promise<string | null> {
    if (!organizationId) return null;
    const admin = await this.prisma.user.findFirst({
      where: { organizationId, role: 'ADMIN', isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (admin) return admin.id;
    const anyUser = await this.prisma.user.findFirst({
      where: { organizationId, isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return anyUser?.id ?? null;
  }

  /**
   * Tek giriş noktası: durum güncelleme + aktivite + hatırlatma görevi.
   * Otomatik yanıt ve HTTP PATCH aynı mantığı kullanır.
   */
  async applyLeadStatusChange(params: {
    leadId: string;
    to: LeadStatus;
    userId: string | null;
    lossReason?: string | null;
    /** Otomasyonda LOST için neden zorunlu tutulmaz */
    requireLossReason?: boolean;
  }) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: params.leadId },
      include: { contact: true },
    });
    if (!lead) throw new NotFoundException('Lead bulunamadı');

    assertLeadStatusTransition(lead.status, params.to, {
      lossReason: params.lossReason,
      requireLossReason: params.requireLossReason,
    });

    const actingUserId =
      params.userId ??
      (await this.resolveAutomationActingUserId(lead.contact.organizationId));

    const patch: {
      status: LeadStatus;
      closedAt: Date | null;
      lossReason?: string | null;
    } = {
      status: params.to,
      closedAt:
        params.to === LeadStatus.WON || params.to === LeadStatus.LOST ? new Date() : null,
    };
    if (params.to === LeadStatus.LOST) {
      patch.lossReason = params.lossReason?.trim() || null;
    } else {
      patch.lossReason = null;
    }

    const updated = await this.prisma.lead.update({
      where: { id: params.leadId },
      data: patch,
      include: { contact: true },
    });

    if (actingUserId) {
      let desc = `Lead durumu "${this.statusLabels[params.to] || params.to}" olarak değiştirildi`;
      if (params.to === LeadStatus.LOST && patch.lossReason) {
        desc += ` (Neden: ${patch.lossReason})`;
      }
      await this.prisma.activity.create({
        data: {
          leadId: params.leadId,
          userId: actingUserId,
          type: 'STATUS_CHANGE',
          description: desc,
        },
      });

      const followUpStatuses: LeadStatus[] = [
        LeadStatus.CONTACTED,
        LeadStatus.INTERESTED,
        LeadStatus.OFFER_SENT,
      ];
      if (followUpStatuses.includes(params.to)) {
        await this.tasksService.createFollowUpReminder({
          userId: actingUserId,
          contactId: updated.contactId,
          contactName: updated.contact.name || updated.contact.phone,
          trigger: params.to,
          delayHours: 24,
        });
      }
    }

    return updated;
  }

  /** Otomatik yanıt akışı: contactId üzerinden lead bul/oluştur ve durumu uygula */
  async setLeadStatusForContact(params: {
    contactId: string;
    status: LeadStatus;
    lossReason?: string | null;
  }) {
    let lead = await this.prisma.lead.findUnique({ where: { contactId: params.contactId } });
    if (!lead) {
      lead = await this.prisma.lead.create({
        data: { contactId: params.contactId, status: LeadStatus.NEW },
      });
    }
    return this.applyLeadStatusChange({
      leadId: lead.id,
      to: params.status,
      userId: null,
      lossReason: params.lossReason,
      requireLossReason: false,
    });
  }

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
    let targetContactId = data.contactId;

    // Contact'ın organizationId'si boşsa ve kullanıcının org'u varsa, sessizce ata
    if (organizationId) {
      const contact = await this.prisma.contact.findUnique({
        where: { id: data.contactId },
        select: { id: true, organizationId: true },
      });
      if (!contact) {
        throw new NotFoundException('Kişi bulunamadı');
      }
      if (!contact.organizationId) {
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: { organizationId },
        });
      }
      targetContactId = contact.id;
      // org eşleşmese bile devam et (tek kullanıcı modu)
    }

    const existing = await this.prisma.lead.findUnique({
      where: { contactId: targetContactId },
      include: { contact: true },
    });
    if (existing) return existing;

    return this.prisma.lead.create({
      data: {
        contactId: targetContactId,
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
    const where: Record<string, unknown> = {};

    if (status) where.status = status;

    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Record<string, Date>).gte = new Date(from);
      if (to) (where.createdAt as Record<string, Date>).lte = new Date(to);
    }

    const contactFilter: Record<string, unknown> = {};
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

  async updateStatus(
    id: string,
    status: LeadStatus,
    userId: string,
    lossReason?: string | null,
  ) {
    return this.applyLeadStatusChange({
      leadId: id,
      to: status,
      userId,
      lossReason,
      requireLossReason: true,
    });
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
