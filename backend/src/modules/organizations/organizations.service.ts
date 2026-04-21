import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
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

}
