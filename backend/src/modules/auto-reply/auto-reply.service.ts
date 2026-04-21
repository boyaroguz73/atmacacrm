import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

export interface FlowStep {
  id: string;
  type: 'send_message' | 'wait' | 'condition' | 'assign_agent' | 'add_tag' | 'set_lead_status';
  data: Record<string, any>;
  nextStepId?: string | null;
}

export interface FlowCondition {
  field: 'message_contains' | 'message_exact' | 'contact_tag' | 'time_range';
  operator: 'contains' | 'equals' | 'not_contains' | 'starts_with';
  value: string;
}

@Injectable()
export class AutoReplyService {
  private readonly logger = new Logger(AutoReplyService.name);

  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async findAll(organizationId?: string) {
    const where: any = {};
    if (organizationId) where.organizationId = organizationId;

    return this.prisma.autoReplyFlow.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { creator: { select: { id: true, name: true } } },
    });
  }

  async findById(id: string) {
    const flow = await this.prisma.autoReplyFlow.findUnique({
      where: { id },
      include: { creator: { select: { id: true, name: true } } },
    });
    if (!flow) throw new NotFoundException('Akış bulunamadı');
    return flow;
  }

  async findActiveFlows(organizationId?: string) {
    if (!organizationId) return [];

    return this.prisma.autoReplyFlow.findMany({
      where: {
        isActive: true,
        organizationId,
        OR: [{ activeFrom: null }, { activeFrom: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    data: {
      name: string;
      description?: string;
      trigger: string;
      conditions?: any;
      steps: FlowStep[];
      activeFrom?: string | Date;
    },
    userId: string,
    organizationId?: string,
  ) {
    const flow = await this.prisma.autoReplyFlow.create({
      data: {
        ...data,
        steps: data.steps as any,
        activeFrom: data.activeFrom ? new Date(data.activeFrom) : null,
        createdBy: userId,
        ...(organizationId ? { organizationId } : {}),
      },
      include: { creator: { select: { id: true, name: true } } },
    });

    await this.auditLog.log({
      userId,
      organizationId,
      action: 'CREATE',
      entity: 'AutoReplyFlow',
      entityId: flow.id,
      details: { name: data.name },
    });

    return flow;
  }

  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      trigger?: string;
      conditions?: any;
      steps?: FlowStep[];
      isActive?: boolean;
      activeFrom?: string | Date | null;
    },
    userId: string,
  ) {
    await this.findById(id);
    const updateData: any = { ...data };
    if (data.steps) updateData.steps = data.steps as any;
    if (Object.prototype.hasOwnProperty.call(data, 'activeFrom')) {
      updateData.activeFrom = data.activeFrom ? new Date(data.activeFrom) : null;
    }

    const flow = await this.prisma.autoReplyFlow.update({
      where: { id },
      data: updateData,
      include: { creator: { select: { id: true, name: true } } },
    });

    await this.auditLog.log({
      userId,
      action: 'UPDATE',
      entity: 'AutoReplyFlow',
      entityId: flow.id,
      details: data,
    });

    return flow;
  }

  async delete(id: string, userId: string) {
    await this.findById(id);

    await this.auditLog.log({
      userId,
      action: 'DELETE',
      entity: 'AutoReplyFlow',
      entityId: id,
    });

    return this.prisma.autoReplyFlow.delete({ where: { id } });
  }

  async toggleActive(id: string, userId: string) {
    const flow = await this.findById(id);
    return this.update(id, { isActive: !flow.isActive }, userId);
  }

  matchesTrigger(
    flow: { trigger: string; conditions: any },
    messageBody: string,
  ): boolean {
    const trigger = flow.trigger;
    const conditions = (flow.conditions as FlowCondition[]) || [];

    if (trigger === 'new_message') return true;

    if (trigger === 'keyword') {
      if (conditions.length === 0) return false;
      return conditions.some((cond) => {
        const val = cond.value?.toLowerCase() || '';
        const msg = messageBody.toLowerCase();
        switch (cond.operator) {
          case 'contains':
            return msg.includes(val);
          case 'equals':
            return msg === val;
          case 'starts_with':
            return msg.startsWith(val);
          case 'not_contains':
            return !msg.includes(val);
          default:
            return false;
        }
      });
    }

    if (trigger === 'first_message') {
      return true;
    }

    return false;
  }
}
