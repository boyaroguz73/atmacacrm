import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.UserCreateInput) {
    return this.prisma.user.create({ data, select: UsersService.safeSelect });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  private static readonly safeSelect = {
    id: true,
    email: true,
    name: true,
    role: true,
    isActive: true,
    avatar: true,
    createdAt: true,
    organizationId: true,
  } as const;

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: UsersService.safeSelect,
    });
  }

  async findByIdUnsafe(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findAll(organizationId?: string) {
    const where: Prisma.UserWhereInput = {};
    if (organizationId) {
      where.organizationId = organizationId;
    }
    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        avatar: true,
        createdAt: true,
        organizationId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAgents(organizationId?: string) {
    const where: Prisma.UserWhereInput = { role: 'AGENT', isActive: true };
    if (organizationId) {
      where.organizationId = organizationId;
    }
    return this.prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, avatar: true },
    });
  }

  /** Gelen kutusu: ADMIN + AGENT. Tek firma — organizationId verilirse daraltır, yoksa tüm aktif yönetici/temsilciler. */
  async findInboxPeers(organizationId: string | null | undefined) {
    const where: Prisma.UserWhereInput = {
      role: { in: ['AGENT', 'ADMIN'] },
      isActive: true,
    };
    if (organizationId) {
      where.organizationId = organizationId;
    }
    return this.prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  async update(id: string, data: Prisma.UserUpdateInput) {
    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        avatar: true,
      },
    });
  }

  async deactivate(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: UsersService.safeSelect,
    });
  }

  async findAllGrouped() {
    const orgs = await this.prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        isActive: true,
        maxUsers: true,
        maxSessions: true,
        createdAt: true,
        users: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            avatar: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const unassigned = await this.prisma.user.findMany({
      where: { organizationId: null },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        avatar: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      organizations: orgs,
      unassigned,
      totalUsers: orgs.reduce((sum, o) => sum + o.users.length, 0) + unassigned.length,
    };
  }
}
