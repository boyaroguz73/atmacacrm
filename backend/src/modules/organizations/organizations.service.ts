import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MENU_KEYS,
  MenuVisibilityOverrides,
  effectiveMenuKeys,
  sanitizeMenuKeys,
} from '../../common/menu-visibility';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}
  private static readonly OP_RESET_PASSWORD = '123@123';

  private readonly moduleToggleKeys = [
    'whatsapp',
    'tsoft',
    'kartelas',
    'templates',
    'suppliers',
    'cargoCompanies',
    'automation',
    'quotes',
  ] as const;

  /** Tek firma: kullanıcıda organizationId yoksa branding/entegrasyon için ilk kayıt */
  async getFirstOrganizationId(): Promise<string | null> {
    const row = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async findAll() {
    return this.prisma.organization.findMany({
      include: {
        _count: { select: { users: true, sessions: true, contacts: true } },
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIALING'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        users: {
          select: { id: true, name: true, email: true, role: true, isActive: true, avatar: true },
        },
        sessions: {
          select: { id: true, name: true, phone: true, status: true },
        },
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        _count: { select: { contacts: true, invoices: true } },
      },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');
    return org;
  }

  async create(data: {
    name: string;
    slug: string;
    plan?: string;
    maxUsers?: number;
    maxSessions?: number;
  }) {
    const existing = await this.prisma.organization.findUnique({
      where: { slug: data.slug },
    });
    if (existing) throw new ConflictException('Bu slug zaten kullanılıyor');

    return this.prisma.organization.create({ data: data as any });
  }

  async update(id: string, data: any) {
    return this.prisma.organization.update({ where: { id }, data });
  }

  async updateBranding(
    id: string,
    data: {
      name?: string;
      logo?: string;
      primaryColor?: string;
      secondaryColor?: string;
      billingEmail?: string;
      billingName?: string;
      billingAddress?: string;
      taxNumber?: string;
    },
  ) {
    return this.prisma.organization.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        primaryColor: true,
        secondaryColor: true,
        billingEmail: true,
        billingName: true,
        billingAddress: true,
        taxNumber: true,
        plan: true,
      },
    });
  }

  async getStats() {
    const [orgCount, userCount, sessionCount, contactCount] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.user.count(),
      this.prisma.whatsappSession.count(),
      this.prisma.contact.count(),
    ]);

    const activeOrgs = await this.prisma.organization.count({
      where: { isActive: true },
    });

    const planDistribution = await this.prisma.organization.groupBy({
      by: ['plan'],
      _count: true,
    });

    return {
      organizations: { total: orgCount, active: activeOrgs },
      users: userCount,
      sessions: sessionCount,
      contacts: contactCount,
      planDistribution,
      totalOrganizations: orgCount,
      activeOrganizations: activeOrgs,
      totalUsers: userCount,
      totalSessions: sessionCount,
      totalContacts: contactCount,
    };
  }

  async assignUserToOrg(userId: string, organizationId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { organizationId },
    });
  }

  async assignSessionToOrg(sessionId: string, organizationId: string) {
    return this.prisma.whatsappSession.update({
      where: { id: sessionId },
      data: { organizationId },
    });
  }

  private parseSettings(settings: Prisma.JsonValue | null): Record<string, unknown> {
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      return settings as Record<string, unknown>;
    }
    return {};
  }

  getModuleTogglesFromOrg(settings: Prisma.JsonValue | null): Record<string, boolean> {
    const s = this.parseSettings(settings);
    const raw = s.moduleToggles;
    const defaults: Record<string, boolean> = {};
    for (const key of this.moduleToggleKeys) defaults[key] = true;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
    const src = raw as Record<string, unknown>;
    for (const key of this.moduleToggleKeys) {
      if (typeof src[key] === 'boolean') defaults[key] = src[key] as boolean;
    }
    return defaults;
  }

  async getModuleToggles(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');
    return { toggles: this.getModuleTogglesFromOrg(org.settings) };
  }

  async patchModuleToggles(organizationId: string, body: Record<string, boolean | undefined>) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');

    const prev = this.parseSettings(org.settings);
    const nextToggles = this.getModuleTogglesFromOrg(org.settings);
    for (const key of this.moduleToggleKeys) {
      if (typeof body[key] === 'boolean') nextToggles[key] = !!body[key];
    }

    const nextSettings = { ...prev, moduleToggles: nextToggles };
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: nextSettings as Prisma.InputJsonValue },
    });

    if (nextToggles.tsoft === false) {
      await this.prisma.orgIntegration.updateMany({
        where: {
          organizationId,
          integrationKey: { in: ['tsoft'] },
        },
        data: { isEnabled: false },
      });
    }

    return { toggles: nextToggles };
  }

  getMenuOverridesFromOrg(settings: Prisma.JsonValue | null): MenuVisibilityOverrides | null {
    const s = this.parseSettings(settings);
    const raw = s.menuVisibility;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    const out: MenuVisibilityOverrides = {};
    for (const role of ['AGENT', 'ACCOUNTANT', 'ADMIN'] as const) {
      const v = o[role];
      if (Array.isArray(v)) {
        const arr = v.filter((x): x is string => typeof x === 'string');
        if (arr.length) out[role] = sanitizeMenuKeys(arr);
      }
    }
    return Object.keys(out).length ? out : null;
  }

  getMenuVisibilityPayload(organizationId: string, role: string | undefined) {
    return this.prisma.organization
      .findUnique({
        where: { id: organizationId },
        select: { settings: true },
      })
      .then((org) => {
        const overrides = this.getMenuOverridesFromOrg(org?.settings ?? null);
        return {
          allowedKeys: effectiveMenuKeys(role, overrides),
          allKeys: [...MENU_KEYS],
          overrides: overrides ?? undefined,
          preview: {
            AGENT: effectiveMenuKeys('AGENT', overrides),
            ACCOUNTANT: effectiveMenuKeys('ACCOUNTANT', overrides),
            ADMIN: effectiveMenuKeys('ADMIN', overrides),
          },
        };
      });
  }

  async patchMenuVisibility(organizationId: string, body: MenuVisibilityOverrides) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');
    const prev = this.parseSettings(org.settings);
    const mergedOverrides: Record<string, string[]> = {};
    for (const role of ['AGENT', 'ACCOUNTANT', 'ADMIN'] as const) {
      if (body[role] !== undefined) {
        mergedOverrides[role] = sanitizeMenuKeys(body[role] ?? []);
      }
    }
    const prevMv = (prev.menuVisibility as Record<string, unknown> | undefined) ?? {};
    const nextMv = { ...prevMv, ...mergedOverrides };
    const nextSettings = { ...prev, menuVisibility: nextMv };
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: nextSettings as Prisma.InputJsonValue },
    });
    const overrides = this.getMenuOverridesFromOrg(nextSettings as Prisma.JsonValue);
    return {
      overrides: overrides ?? undefined,
      preview: {
        AGENT: effectiveMenuKeys('AGENT', overrides),
        ACCOUNTANT: effectiveMenuKeys('ACCOUNTANT', overrides),
        ADMIN: effectiveMenuKeys('ADMIN', overrides),
      },
    };
  }

  private parseMenuSuborder(settings: Prisma.JsonValue | null): Record<string, string[]> | null {
    const s = this.parseSettings(settings);
    const raw = s.menuSuborder;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const cleaned = [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0))];
      if (cleaned.length) out[k] = cleaned;
    }
    return Object.keys(out).length ? out : null;
  }

  private parseMenuSubHidden(settings: Prisma.JsonValue | null): Record<string, string[]> | null {
    const s = this.parseSettings(settings);
    const raw = s.menuSubHidden;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const cleaned = [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0))];
      if (cleaned.length) out[k] = cleaned;
    }
    return Object.keys(out).length ? out : null;
  }

  async getMenuSubHidden(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');
    return { subHidden: this.parseMenuSubHidden(org.settings) ?? {} };
  }

  async patchMenuSubHidden(organizationId: string, body: Record<string, string[] | undefined>) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');
    const prev = this.parseSettings(org.settings);
    const cur = this.parseMenuSubHidden(org.settings) ?? {};
    const next: Record<string, string[]> = { ...cur };
    for (const [parentKey, values] of Object.entries(body || {})) {
      if (values === undefined) continue;
      const cleaned = [...new Set(values.filter((x): x is string => typeof x === 'string' && x.trim().length > 0))];
      if (cleaned.length) next[parentKey] = cleaned;
      else delete next[parentKey];
    }
    const nextSettings = { ...prev, menuSubHidden: next };
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: nextSettings as Prisma.InputJsonValue },
    });
    return { subHidden: next };
  }

  async getMenuSuborder(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');
    return { suborder: this.parseMenuSuborder(org.settings) ?? {} };
  }

  async patchMenuSuborder(organizationId: string, body: Record<string, string[] | undefined>) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');
    const prev = this.parseSettings(org.settings);
    const cur = this.parseMenuSuborder(org.settings) ?? {};
    const next: Record<string, string[]> = { ...cur };
    for (const [parentKey, values] of Object.entries(body || {})) {
      if (values === undefined) continue;
      const cleaned = [...new Set(values.filter((x): x is string => typeof x === 'string' && x.trim().length > 0))];
      if (cleaned.length) next[parentKey] = cleaned;
      else delete next[parentKey];
    }
    const nextSettings = { ...prev, menuSuborder: next };
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: nextSettings as Prisma.InputJsonValue },
    });
    return { suborder: next };
  }

  getDefaultLocationSettings(organizationId: string) {
    return this.prisma.organization
      .findUnique({
        where: { id: organizationId },
        select: { settings: true },
      })
      .then((org) => {
        const prev = this.parseSettings(org?.settings ?? null);
        const loc = (prev.defaultLocation as Record<string, unknown> | undefined) ?? {};
        return {
          latitude: typeof loc.latitude === 'number' ? loc.latitude : null,
          longitude: typeof loc.longitude === 'number' ? loc.longitude : null,
          mapsUrl: typeof loc.mapsUrl === 'string' ? loc.mapsUrl : '',
          title: typeof loc.title === 'string' ? loc.title : '',
          address: typeof loc.address === 'string' ? loc.address : '',
        };
      });
  }

  async patchDefaultLocationSettings(
    organizationId: string,
    body: {
      latitude?: number | null;
      longitude?: number | null;
      mapsUrl?: string | null;
      title?: string | null;
      address?: string | null;
    },
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');
    const prev = this.parseSettings(org.settings);
    const cur = (prev.defaultLocation as Record<string, unknown> | undefined) ?? {};
    const nextLoc: Record<string, unknown> = {
      ...cur,
      ...body,
      mapsUrl:
        body.mapsUrl != null
          ? String(body.mapsUrl).trim()
          : typeof cur.mapsUrl === 'string'
            ? cur.mapsUrl
            : '',
      title: (body.title ?? (cur.title as string) ?? '').toString().trim(),
      address: (body.address ?? (cur.address as string) ?? '').toString().trim(),
    };
    if (typeof nextLoc.latitude !== 'number' || !Number.isFinite(nextLoc.latitude)) {
      nextLoc.latitude = null;
    }
    if (typeof nextLoc.longitude !== 'number' || !Number.isFinite(nextLoc.longitude)) {
      nextLoc.longitude = null;
    }
    const nextSettings = { ...prev, defaultLocation: nextLoc };
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: nextSettings as Prisma.InputJsonValue },
    });
    return this.getDefaultLocationSettings(organizationId);
  }

  async getOrganizationDashboard(organizationId: string) {
    const [users, sessions, contacts, conversations, messages] =
      await Promise.all([
        this.prisma.user.count({ where: { organizationId } }),
        this.prisma.whatsappSession.count({ where: { organizationId } }),
        this.prisma.contact.count({ where: { organizationId } }),
        this.prisma.conversation.count({
          where: { session: { organizationId } },
        }),
        this.prisma.message.count({
          where: { session: { organizationId } },
        }),
      ]);

    return { users, sessions, contacts, conversations, messages };
  }

  /**
   * Operasyonel kayıtları temizler ve WA session koduna göre atama eşleştirmesini tekrar uygular.
   */
  async resetOperationalDataAndReassign(
    organizationId: string,
    password: string,
  ): Promise<{
    reset: {
      quotes: number;
      orders: number;
      tasks: number;
      leads: number;
      orderItems: number;
      cashEntries: number;
      accountingInvoices: number;
      ledgerEntries: number;
      deliveryNotes: number;
    };
    reassignment: {
      mappings: number;
      targets: number;
      closed: number;
      inserted: number;
    };
  }> {
    if (String(password || '') !== OrganizationsService.OP_RESET_PASSWORD) {
      throw new BadRequestException('Şifre hatalı');
    }

    return this.prisma.$transaction(async (tx) => {
      const [targetOrders, targetQuotes, orgUsers] = await Promise.all([
        tx.salesOrder.findMany({
          where: { contact: { organizationId } },
          select: { id: true },
        }),
        tx.quote.findMany({
          where: { contact: { organizationId } },
          select: { id: true },
        }),
        tx.user.findMany({
          where: { organizationId },
          select: { id: true },
        }),
      ]);

      const orderIds = targetOrders.map((o) => o.id);
      const quoteIds = targetQuotes.map((q) => q.id);
      const userIds = orgUsers.map((u) => u.id);
      const userIdWhere = userIds.length > 0 ? { in: userIds } : undefined;

      let orderItemsDeleted = 0;
      let cashDeleted = 0;
      let accInvoiceDeleted = 0;
      let ledgerDeleted = 0;
      let deliveryDeleted = 0;
      if (orderIds.length > 0) {
        const [di, dd] = await Promise.all([
          tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
          tx.deliveryNote.deleteMany({ where: { orderId: { in: orderIds } } }),
        ]);
        orderItemsDeleted = di.count;
        deliveryDeleted = dd.count;
      }

      const [deletedQuotes, deletedOrders, deletedTasks, deletedLeads] = await Promise.all([
        tx.quote.deleteMany({ where: { id: { in: quoteIds } } }),
        tx.salesOrder.deleteMany({ where: { id: { in: orderIds } } }),
        userIdWhere ? tx.task.deleteMany({ where: { userId: userIdWhere } }) : Promise.resolve({ count: 0 }),
        tx.lead.deleteMany({ where: { contact: { organizationId } } }),
      ]);

      if (userIdWhere) {
        const [dc, dai, dle] = await Promise.all([
          tx.cashBookEntry.deleteMany({ where: { userId: userIdWhere } }),
          tx.accountingInvoice.deleteMany({ where: { contact: { organizationId } } }),
          tx.ledgerEntry.deleteMany({ where: { userId: userIdWhere } }),
        ]);
        cashDeleted = dc.count;
        accInvoiceDeleted = dai.count;
        ledgerDeleted = dle.count;
      }

      const mappings = [
        { suffix: '0415', fullName: 'Umeyma', email: 'umeyma@atmacaofis.com.tr' },
        { suffix: '0456', fullName: 'Betül', email: 'betul@atmacaofis.com.tr' },
        { suffix: '0440', fullName: 'Sümeyye', email: 'sumeyye@atmacaofis.com.tr' },
      ] as const;

      let targets = 0;
      let closed = 0;
      let inserted = 0;

      for (const m of mappings) {
        const agent = await tx.user.findFirst({
          where: {
            organizationId,
            role: 'AGENT',
            isActive: true,
            OR: [
              { name: { equals: m.fullName, mode: 'insensitive' } },
              { email: { equals: m.email, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        });
        if (!agent) continue;

        const convs = await tx.conversation.findMany({
          where: {
            session: { name: { contains: m.suffix } },
            contact: { organizationId },
          },
          select: { id: true },
        });
        const convIds = convs.map((c) => c.id);
        if (!convIds.length) continue;
        targets += convIds.length;

        const closedRes = await tx.assignment.updateMany({
          where: {
            conversationId: { in: convIds },
            unassignedAt: null,
            userId: { not: agent.id },
          },
          data: { unassignedAt: new Date() },
        });
        closed += closedRes.count;

        const existingActive = await tx.assignment.findMany({
          where: {
            conversationId: { in: convIds },
            unassignedAt: null,
          },
          select: { conversationId: true },
        });
        const activeSet = new Set(existingActive.map((a) => a.conversationId));
        const missing = convIds.filter((id) => !activeSet.has(id));
        if (missing.length > 0) {
          const ins = await tx.assignment.createMany({
            data: missing.map((conversationId) => ({
              conversationId,
              userId: agent.id,
              assignedAt: new Date(),
            })),
          });
          inserted += ins.count;
        }
      }

      return {
        reset: {
          quotes: deletedQuotes.count,
          orders: deletedOrders.count,
          tasks: deletedTasks.count,
          leads: deletedLeads.count,
          orderItems: orderItemsDeleted,
          cashEntries: cashDeleted,
          accountingInvoices: accInvoiceDeleted,
          ledgerEntries: ledgerDeleted,
          deliveryNotes: deliveryDeleted,
        },
        reassignment: {
          mappings: mappings.length,
          targets,
          closed,
          inserted,
        },
      };
    });
  }

}
