import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketStatus, TicketPriority } from '@prisma/client';

@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService) {}

  async createTicket(data: {
    organizationId: string;
    createdById: string;
    subject: string;
    description: string;
    priority?: TicketPriority;
    category?: string;
  }) {
    return this.prisma.supportTicket.create({
      data: {
        organizationId: data.organizationId,
        createdById: data.createdById,
        subject: data.subject,
        description: data.description,
        priority: data.priority || 'MEDIUM',
        category: data.category,
      },
      include: {
        organization: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async findAll(filters?: {
    organizationId?: string;
    status?: TicketStatus;
    priority?: TicketPriority;
  }) {
    const where: any = {};
    if (filters?.organizationId) where.organizationId = filters.organizationId;
    if (filters?.status) where.status = filters.status;
    if (filters?.priority) where.priority = filters.priority;

    return this.prisma.supportTicket.findMany({
      where,
      include: {
        organization: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true, role: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        messages: {
          include: {
            user: { select: { id: true, name: true, role: true, avatar: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Destek talebi bulunamadı');
    return ticket;
  }

  async updateTicket(
    id: string,
    data: {
      status?: TicketStatus;
      priority?: TicketPriority;
      assignedToId?: string | null;
      category?: string;
    },
  ) {
    const updateData: any = {};
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId;
    if (data.category !== undefined) updateData.category = data.category;

    if (data.status === 'CLOSED' || data.status === 'RESOLVED') {
      updateData.closedAt = new Date();
    }

    return this.prisma.supportTicket.update({
      where: { id },
      data: updateData,
      include: {
        organization: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async addMessage(ticketId: string, userId: string, body: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('Destek talebi bulunamadı');

    const message = await this.prisma.ticketMessage.create({
      data: { ticketId, userId, body },
      include: {
        user: { select: { id: true, name: true, role: true, avatar: true } },
      },
    });

    if (ticket.status === 'OPEN') {
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'IN_PROGRESS' },
      });
    }

    return message;
  }

  async getTicketStats() {
    const [open, inProgress, resolved, closed, total] = await Promise.all([
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      this.prisma.supportTicket.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.supportTicket.count({ where: { status: 'RESOLVED' } }),
      this.prisma.supportTicket.count({ where: { status: 'CLOSED' } }),
      this.prisma.supportTicket.count(),
    ]);
    return { open, inProgress, resolved, closed, total };
  }
}
