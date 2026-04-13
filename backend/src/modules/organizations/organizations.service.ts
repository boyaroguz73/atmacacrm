import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

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
