import { Injectable, Logger } from '@nestjs/common';
import { AutoReplyService, FlowStep } from './auto-reply.service';
import { WahaService } from '../waha/waha.service';
import { PrismaService } from '../prisma/prisma.service';
import { MessageDirection, MessageStatus, LeadStatus } from '@prisma/client';
import { LeadsService } from '../leads/leads.service';
import { ConversationsService } from '../conversations/conversations.service';

@Injectable()
export class AutoReplyEngineService {
  private readonly logger = new Logger(AutoReplyEngineService.name);

  constructor(
    private autoReplyService: AutoReplyService,
    private wahaService: WahaService,
    private prisma: PrismaService,
    private leadsService: LeadsService,
    private conversationsService: ConversationsService,
  ) {}

  async processOrderStatusEvent(params: {
    orderId: string;
    status: string;
    organizationId: string;
  }) {
    try {
      const order = await this.prisma.salesOrder.findUnique({
        where: { id: params.orderId },
        include: {
          contact: true,
          items: true,
        },
      });
      if (!order || order.source !== 'TSOFT') return;

      const flows = await this.autoReplyService.findActiveFlows(params.organizationId);
      const matched = flows.filter((f) => this.matchesOrderStatusTrigger(f, params.status));
      if (!matched.length) return;

      for (const flow of matched) {
        const sentKey = `${flow.id}:${params.status}`;
        if (this.hasOrderAutomationSent(order.automationState, sentKey)) continue;

        const session = await this.pickWorkingSession(params.organizationId);
        if (!session) continue;

        const phoneDigits = String(order.contact.phone || '').replace(/\D/g, '');
        if (!phoneDigits) continue;
        const chatId = `${phoneDigits}@c.us`;

        const conversation = await this.prisma.conversation.upsert({
          where: { contactId_sessionId: { contactId: order.contactId, sessionId: session.id } },
          update: {},
          create: { contactId: order.contactId, sessionId: session.id },
          include: {
            assignments: {
              where: { unassignedAt: null },
              include: { user: { select: { id: true, name: true } } },
            },
          },
        });

        if (!conversation.assignments.length) {
          await this.conversationsService.autoAssignRoundRobin(conversation.id, params.organizationId);
        }
        const currentAssignment = await this.prisma.assignment.findFirst({
          where: { conversationId: conversation.id, unassignedAt: null },
          include: { user: { select: { id: true, name: true } } },
          orderBy: { assignedAt: 'desc' },
        });
        const agentName = currentAssignment?.user?.name?.trim() || 'Temsilci';

        const firstMessageStep = ((flow.steps as FlowStep[]) || []).find((s) => s.type === 'send_message');
        const template = String(firstMessageStep?.data?.message || '').trim();
        if (!template) continue;

        const text = this.renderOrderTemplate(template, {
          agentName,
          status: params.status,
          items: order.items.map((i) => ({
            name: i.name,
            property2: i.measurementInfo || '',
            unitPrice: Number(i.unitPrice) || 0,
            currency: order.currency || 'TRY',
            priceIncludesVat: i.priceIncludesVat !== false,
          })),
        });

        const waResponse = await this.wahaService.sendText(session.name, chatId, text);
        const waMessageId =
          typeof waResponse?.id === 'string'
            ? waResponse.id
            : waResponse?.id?._serialized || waResponse?.id?.id || null;

        await this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            sessionId: session.id,
            waMessageId,
            direction: MessageDirection.OUTGOING,
            body: text,
            status: MessageStatus.SENT,
            metadata: {
              autoReply: true,
              automationType: 'order_status',
              flowId: flow.id,
              orderId: order.id,
              status: params.status,
            },
          },
        });
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageText: text, lastMessageAt: new Date() },
        });

        const prevState =
          order.automationState && typeof order.automationState === 'object'
            ? (order.automationState as Record<string, unknown>)
            : {};
        const sent =
          prevState.sent && typeof prevState.sent === 'object'
            ? (prevState.sent as Record<string, unknown>)
            : {};
        await this.prisma.salesOrder.update({
          where: { id: order.id },
          data: {
            automationState: {
              ...prevState,
              sent: {
                ...sent,
                [sentKey]: new Date().toISOString(),
              },
            },
          },
        });
      }
    } catch (err: any) {
      this.logger.error(`Sipariş otomasyonu hatası: ${err?.message || err}`);
    }
  }

  private hasOrderAutomationSent(state: unknown, sentKey: string): boolean {
    if (!state || typeof state !== 'object') return false;
    const sent = (state as Record<string, unknown>).sent;
    if (!sent || typeof sent !== 'object') return false;
    return !!(sent as Record<string, unknown>)[sentKey];
  }

  private matchesOrderStatusTrigger(
    flow: { trigger: string; conditions: unknown },
    status: string,
  ): boolean {
    if (flow.trigger !== 'order_status') return false;
    const cond = flow.conditions && typeof flow.conditions === 'object'
      ? (flow.conditions as Record<string, unknown>)
      : {};
    const statuses = Array.isArray(cond.statuses) ? cond.statuses.map((s) => String(s)) : [];
    if (!statuses.length) return false;
    return statuses.includes(status);
  }

  private async pickWorkingSession(organizationId: string): Promise<{ id: string; name: string } | null> {
    let session = await this.prisma.whatsappSession.findFirst({
      where: { organizationId, status: 'WORKING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (!session) {
      session = await this.prisma.whatsappSession.findFirst({
        where: { organizationId: null, status: 'WORKING' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
      });
    }
    return session;
  }

  private renderOrderTemplate(
    template: string,
    data: {
      agentName: string;
      status: string;
      items: Array<{
        name: string;
        property2: string;
        unitPrice: number;
        currency: string;
        priceIncludesVat: boolean;
      }>;
    },
  ): string {
    const lines = data.items.map((it) => {
      const curr = (it.currency || 'TRY').toUpperCase() === 'TRY' ? 'TL' : (it.currency || 'TRY').toUpperCase();
      const price = `${it.unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${curr}`;
      const vat = it.priceIncludesVat ? '(KDV Dahil)' : '+KDV';
      const suffix = it.property2 ? `, ${it.property2}` : '';
      return `${it.name}${suffix}, ${price} ${vat}`;
    });
    return template
      .replace(/\{Temsilci Adı\}/g, data.agentName)
      .replace(/\{Sipariş Durumu\}/g, data.status)
      .replace(/\{Ürünler\}/g, lines.join('\n'));
  }

  async processIncomingMessage(params: {
    sessionName: string;
    chatId: string;
    messageBody: string;
    conversationId: string;
    contactId: string;
    isFirstMessage: boolean;
  }) {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: params.conversationId },
        select: { contact: { select: { organizationId: true } } },
      });
      const orgId = conversation?.contact?.organizationId ?? undefined;

      const flows = await this.autoReplyService.findActiveFlows(orgId);
      if (flows.length === 0) return;

      for (const flow of flows) {
        if (flow.trigger === 'first_message' && !params.isFirstMessage) continue;

        if (!this.autoReplyService.matchesTrigger(flow, params.messageBody)) continue;

        this.logger.log(`Otomatik yanıt akışı tetiklendi: ${flow.name}`);
        await this.executeFlow(flow, params);
        break; // ilk eşleşen akış çalışır
      }
    } catch (err: any) {
      this.logger.error(`Otomatik yanıt hatası: ${err.message}`);
    }
  }

  private async executeFlow(
    flow: { id: string; steps: any },
    params: {
      sessionName: string;
      chatId: string;
      conversationId: string;
      contactId: string;
    },
  ) {
    const steps = (flow.steps as FlowStep[]) || [];
    if (steps.length === 0) return;

    let currentStep: FlowStep | undefined = steps[0];

    while (currentStep) {
      await this.executeStep(currentStep, params);

      if (currentStep.nextStepId) {
        currentStep = steps.find((s) => s.id === currentStep!.nextStepId);
      } else {
        const idx = steps.indexOf(currentStep);
        currentStep = steps[idx + 1];
      }
    }
  }

  private async executeStep(
    step: FlowStep,
    params: {
      sessionName: string;
      chatId: string;
      conversationId: string;
      contactId: string;
    },
  ) {
    switch (step.type) {
      case 'send_message':
        await this.executeSendMessage(step, params);
        break;
      case 'wait':
        await this.executeWait(step);
        break;
      case 'add_tag':
        await this.executeAddTag(step, params);
        break;
      case 'set_lead_status':
        await this.executeSetLeadStatus(step, params);
        break;
      case 'assign_agent':
        await this.executeAssignAgent(step, params);
        break;
      default:
        this.logger.warn(`Bilinmeyen adım türü: ${step.type}`);
    }
  }

  private async executeSendMessage(
    step: FlowStep,
    params: { sessionName: string; chatId: string; conversationId: string },
  ) {
    const text = step.data?.message || '';
    if (!text) return;

    try {
      const waResponse = await this.wahaService.sendText(
        params.sessionName,
        params.chatId,
        text,
      );

      const waMessageId =
        typeof waResponse?.id === 'string'
          ? waResponse.id
          : waResponse?.id?._serialized || waResponse?.id?.id || null;

      const conversation = await this.prisma.conversation.findUnique({
        where: { id: params.conversationId },
      });

      await this.prisma.message.create({
        data: {
          conversationId: params.conversationId,
          sessionId: conversation?.sessionId || '',
          waMessageId,
          direction: MessageDirection.OUTGOING,
          body: text,
          status: MessageStatus.SENT,
          metadata: { autoReply: true },
        },
      });

      await this.prisma.conversation.update({
        where: { id: params.conversationId },
        data: { lastMessageText: text, lastMessageAt: new Date() },
      });

      this.logger.debug(`Otomatik mesaj gönderildi: ${params.chatId}`);
    } catch (err: any) {
      this.logger.error(`Otomatik mesaj gönderilemedi: ${err.message}`);
    }
  }

  private async executeWait(step: FlowStep) {
    const seconds = step.data?.seconds || 1;
    const capped = Math.min(seconds, 30);
    await new Promise((resolve) => setTimeout(resolve, capped * 1000));
  }

  private async executeAddTag(
    step: FlowStep,
    params: { contactId: string },
  ) {
    const tag = step.data?.tag;
    if (!tag) return;

    const contact = await this.prisma.contact.findUnique({
      where: { id: params.contactId },
    });
    if (!contact) return;

    const tags = contact.tags || [];
    if (!tags.includes(tag)) {
      await this.prisma.contact.update({
        where: { id: params.contactId },
        data: { tags: [...tags, tag] },
      });
    }
  }

  private async executeSetLeadStatus(
    step: FlowStep,
    params: { contactId: string },
  ) {
    const status = step.data?.status as LeadStatus | undefined;
    if (!status) return;
    const lossReason =
      typeof step.data?.lossReason === 'string' ? step.data.lossReason : undefined;
    try {
      await this.leadsService.setLeadStatusForContact({
        contactId: params.contactId,
        status,
        lossReason,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`set_lead_status atlandı: ${msg}`);
    }
  }

  private async executeAssignAgent(
    step: FlowStep,
    params: { conversationId: string },
  ) {
    const agentId = step.data?.agentId;
    if (!agentId) return;

    const existing = await this.prisma.assignment.findFirst({
      where: { conversationId: params.conversationId, unassignedAt: null },
    });
    if (existing) return;

    await this.prisma.assignment.create({
      data: { conversationId: params.conversationId, userId: agentId },
    });
  }
}
