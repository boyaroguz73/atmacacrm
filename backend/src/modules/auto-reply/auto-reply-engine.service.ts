import { Injectable, Logger } from '@nestjs/common';
import { AutoReplyService, FlowStep } from './auto-reply.service';
import { WahaService } from '../waha/waha.service';
import { PrismaService } from '../prisma/prisma.service';
import { MessageDirection, MessageStatus, LeadStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { LeadsService } from '../leads/leads.service';
import { ConversationsService } from '../conversations/conversations.service';
import { normalizeWhatsappChatId } from '../../common/whatsapp-chat-id';

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
        include: { contact: true },
      });
      if (!order || order.source !== 'TSOFT') return;
      await this.enqueueStatusRuns({
        trigger: 'order_status',
        status: params.status,
        organizationId: params.organizationId,
        entityType: 'ORDER',
        entityId: order.id,
        contactId: order.contactId,
      });
    } catch (err: any) {
      this.logger.error(`Sipariş otomasyonu hatası: ${err?.message || err}`);
    }
  }

  async processQuoteStatusEvent(params: {
    quoteId: string;
    status: string;
    organizationId: string;
  }) {
    try {
      const quote = await this.prisma.quote.findUnique({
        where: { id: params.quoteId },
        include: { contact: true },
      });
      if (!quote) return;
      await this.enqueueStatusRuns({
        trigger: 'quote_status',
        status: params.status,
        organizationId: params.organizationId,
        entityType: 'QUOTE',
        entityId: quote.id,
        contactId: quote.contactId,
      });
    } catch (err: any) {
      this.logger.error(`Teklif otomasyonu hatası: ${err?.message || err}`);
    }
  }

  async processQuoteConvertedToOrderEvent(params: {
    quoteId: string;
    orderId: string;
    contactId: string;
    organizationId: string;
  }) {
    try {
      const flows = await this.autoReplyService.findActiveFlows(params.organizationId);
      const matched = flows.filter((f) => f.trigger === 'quote_converted_to_order');
      if (!matched.length) return;

      for (const flow of matched) {
        const dedupeKey = `${flow.id}:QUOTE_TO_ORDER:${params.quoteId}:${params.orderId}`;
        await this.prisma.automationRun.upsert({
          where: { dedupeKey },
          create: {
            flowId: flow.id,
            organizationId: params.organizationId,
            trigger: 'quote_converted_to_order',
            entityType: 'ORDER',
            entityId: params.orderId,
            contactId: params.contactId,
            dedupeKey,
            status: 'PENDING',
            nextRunAt: new Date(),
            context: ({
              status: 'Teklif siparişe dönüştü',
              quoteId: params.quoteId,
            } as unknown) as Prisma.InputJsonValue,
          },
          update: {},
        });
      }
    } catch (err: any) {
      this.logger.error(`Teklif->sipariş otomasyonu hatası: ${err?.message || err}`);
    }
  }

  async runPendingRuns(limit = 25): Promise<number> {
    const now = new Date();
    const runs = await this.prisma.automationRun.findMany({
      where: { status: 'PENDING', nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
      include: { flow: true },
    });
    let processed = 0;
    for (const run of runs) {
      const lock = await this.prisma.automationRun.updateMany({
        where: { id: run.id, status: 'PENDING' },
        data: { status: 'RUNNING' },
      });
      if (!lock.count) continue;
      processed++;
      try {
        await this.executeRun(run.id);
      } catch (e: any) {
        const msg = e?.message || String(e);
        await this.prisma.automationRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            attemptCount: { increment: 1 },
            lastError: msg,
          },
        });
        this.logger.warn(`Automation run failed: ${run.id} ${msg}`);
      }
    }
    return processed;
  }

  private async executeRun(runId: string): Promise<void> {
    const run = await this.prisma.automationRun.findUnique({
      where: { id: runId },
      include: { flow: true },
    });
    if (!run || run.status !== 'RUNNING') return;
    const steps = this.parseFlowSteps(run.flow.steps);
    if (!steps.length || run.currentStep >= steps.length) {
      await this.prisma.automationRun.update({ where: { id: run.id }, data: { status: 'COMPLETED' } });
      return;
    }

    const contextObj =
      run.context && typeof run.context === 'object' && !Array.isArray(run.context)
        ? (run.context as Record<string, unknown>)
        : {};
    const statusText = String(contextObj.status || '');
    const runtime = await this.resolveRuntimeContext(run.organizationId, run.contactId, run.conversationId || undefined);
    if (!runtime) {
      await this.prisma.automationRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', lastError: 'Konuşma bağlamı oluşturulamadı' },
      });
      return;
    }

    let idx = run.currentStep;
    while (idx < steps.length) {
      const step = steps[idx];
      if (step.type === 'wait') {
        const waitSec = this.readWaitSeconds(step.data);
        const nextRunAt = new Date(Date.now() + waitSec * 1000);
        await this.prisma.automationRun.update({
          where: { id: run.id },
          data: { status: 'PENDING', currentStep: idx + 1, nextRunAt },
        });
        return;
      }

      if (step.type === 'condition') {
        const ok = await this.evaluateCondition(step.data, runtime.conversationId);
        if (!ok) {
          await this.prisma.automationRun.update({
            where: { id: run.id },
            data: { status: 'COMPLETED', currentStep: idx + 1 },
          });
          return;
        }
        idx++;
        continue;
      }

      if (step.type === 'send_message') {
        const template = String(step.data?.message || '').trim();
        if (!template) {
          idx++;
          continue;
        }
        const text = await this.renderTemplateForRun(run.entityType, run.entityId, template, statusText, runtime.agentName);
        if (text) {
          await this.sendRunMessage(runtime.conversationId, runtime.sessionId, runtime.sessionName, runtime.chatId, text, run);
        }
        idx++;
        continue;
      }

      await this.executeStep(step, {
        sessionName: runtime.sessionName,
        chatId: runtime.chatId,
        conversationId: runtime.conversationId,
        contactId: run.contactId || '',
      });
      idx++;
    }

    await this.prisma.automationRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED', currentStep: idx },
    });
  }

  private readWaitSeconds(data: Record<string, unknown> | undefined): number {
    const d = Number(data?.days || 0);
    const h = Number(data?.hours || 0);
    const m = Number(data?.minutes || 0);
    const s = Number(data?.seconds || 0);
    const total = d * 86400 + h * 3600 + m * 60 + s;
    const safe = Number.isFinite(total) && total > 0 ? total : 1;
    return Math.min(safe, 60 * 60 * 24 * 30);
  }

  private async evaluateCondition(
    data: Record<string, unknown> | undefined,
    conversationId: string,
  ): Promise<boolean> {
    const field = String(data?.field || '');
    if (field !== 'conversation_last_message_older_than') return true;
    const threshold = this.readWaitSeconds(data);
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { lastMessageAt: true },
    });
    if (!conversation?.lastMessageAt) return true;
    const diffSec = Math.floor((Date.now() - new Date(conversation.lastMessageAt).getTime()) / 1000);
    return diffSec >= threshold;
  }

  private async enqueueStatusRuns(params: {
    trigger: 'order_status' | 'quote_status';
    status: string;
    organizationId: string;
    entityType: 'ORDER' | 'QUOTE';
    entityId: string;
    contactId: string;
  }) {
    const flows = await this.autoReplyService.findActiveFlows(params.organizationId);
    const matched = flows.filter((f) =>
      params.trigger === 'order_status'
        ? this.matchesOrderStatusTrigger(f, params.status)
        : this.matchesQuoteStatusTrigger(f, params.status),
    );
    if (!matched.length) return;

    for (const flow of matched) {
      const dedupeKey = `${flow.id}:${params.entityType}:${params.entityId}:${params.status}`;
      await this.prisma.automationRun.upsert({
        where: { dedupeKey },
        create: {
          flowId: flow.id,
          organizationId: params.organizationId,
          trigger: params.trigger,
          entityType: params.entityType,
          entityId: params.entityId,
          contactId: params.contactId,
          dedupeKey,
          status: 'PENDING',
          nextRunAt: new Date(),
          context: ({ status: params.status } as unknown) as Prisma.InputJsonValue,
        },
        update: {},
      });
    }
  }

  private async resolveRuntimeContext(
    organizationId: string,
    contactId: string | null,
    conversationId?: string,
  ): Promise<{
    conversationId: string;
    sessionId: string;
    sessionName: string;
    chatId: string;
    agentName: string;
  } | null> {
    if (!contactId) return null;
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, phone: true },
    });
    if (!contact) return null;

    const phoneDigits = String(contact.phone || '').replace(/\D/g, '');
    if (!phoneDigits) return null;
    const chatId = normalizeWhatsappChatId(`${phoneDigits}@c.us`);

    const conversations = await this.prisma.conversation.findMany({
      where: { contactId: contact.id },
      include: {
        session: {
          select: { id: true, name: true, status: true, organizationId: true, createdAt: true },
        },
        assignments: {
          where: { unassignedAt: null },
          include: { user: { select: { name: true } } },
          orderBy: { assignedAt: 'desc' },
        },
        messages: {
          where: { direction: MessageDirection.OUTGOING, sentById: { not: null } },
          orderBy: { timestamp: 'desc' },
          take: 1,
          include: { sentBy: { select: { name: true } } },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 20,
    });

    const preferredConversationById = conversationId
      ? conversations.find((c) => c.id === conversationId)
      : null;
    const hasWorkingSession = (c: (typeof conversations)[number]) =>
      c.session?.status === 'WORKING' &&
      (c.session.organizationId === organizationId || c.session.organizationId === null);
    const latestWorkingConversation =
      conversations.find((c) => hasWorkingSession(c)) || null;

    let conversation = preferredConversationById;
    if (!conversation || !hasWorkingSession(conversation)) {
      conversation = latestWorkingConversation;
    }

    if (!conversation) {
      const session = await this.pickWorkingSession(organizationId);
      if (!session) return null;
      conversation = await this.prisma.conversation.upsert({
        where: { contactId_sessionId: { contactId: contact.id, sessionId: session.id } },
        update: {},
        create: { contactId: contact.id, sessionId: session.id },
        include: {
          session: { select: { id: true, name: true, status: true, organizationId: true, createdAt: true } },
          assignments: {
            where: { unassignedAt: null },
            include: { user: { select: { name: true } } },
            orderBy: { assignedAt: 'desc' },
          },
          messages: {
            where: { direction: MessageDirection.OUTGOING, sentById: { not: null } },
            orderBy: { timestamp: 'desc' },
            take: 1,
            include: { sentBy: { select: { name: true } } },
          },
        },
      });
    }

    if (!conversation.assignments.length) {
      await this.conversationsService.autoAssignRoundRobin(conversation.id, organizationId);
    }
    const latestOutgoingUserName = String(
      conversation.messages?.[0]?.sentBy?.name || '',
    ).trim();
    const latestAssignedUserName = String(
      conversation.assignments?.[0]?.user?.name || '',
    ).trim();
    const agentName = latestOutgoingUserName || latestAssignedUserName || 'Temsilci';

    return {
      conversationId: conversation.id,
      sessionId: conversation.session.id,
      sessionName: conversation.session.name,
      chatId,
      agentName,
    };
  }

  private async renderTemplateForRun(
    entityType: string,
    entityId: string,
    template: string,
    status: string,
    agentName: string,
  ): Promise<string> {
    if (entityType === 'ORDER') {
      const order = await this.prisma.salesOrder.findUnique({
        where: { id: entityId },
        include: { items: true },
      });
      if (!order) return '';
      return this.renderOrderTemplate(template, {
        agentName,
        status,
        items: order.items.map((i) => ({
          name: i.name,
          property2: i.measurementInfo || '',
          unitPrice: Number(i.unitPrice) || 0,
          currency: order.currency || 'TRY',
          priceIncludesVat: i.priceIncludesVat !== false,
        })),
      });
    }

    const quote = await this.prisma.quote.findUnique({
      where: { id: entityId },
      include: { items: true },
    });
    if (!quote) return '';
    return this.renderQuoteTemplate(template, {
      agentName,
      status,
      items: quote.items.map((i) => ({
        name: i.name,
        property2: i.measurementInfo || '',
        unitPrice: Number(i.unitPrice) || 0,
        currency: quote.currency || 'TRY',
        priceIncludesVat: i.priceIncludesVat !== false,
      })),
    });
  }

  private async sendRunMessage(
    conversationId: string,
    sessionId: string,
    sessionName: string,
    chatId: string,
    text: string,
    run: { id: string; trigger: string; entityType: string; entityId: string; context: unknown; flowId: string },
  ) {
    const normalizedChatId = normalizeWhatsappChatId(chatId);
    const waResponse = await this.wahaService.sendText(sessionName, normalizedChatId, text);
    const waMessageId =
      typeof waResponse?.id === 'string'
        ? waResponse.id
        : waResponse?.id?._serialized || waResponse?.id?.id || null;
    const ctx =
      run.context && typeof run.context === 'object' && !Array.isArray(run.context)
        ? (run.context as Record<string, unknown>)
        : {};
    await this.prisma.message.create({
      data: {
        conversationId,
        sessionId,
        waMessageId,
        direction: MessageDirection.OUTGOING,
        body: text,
        status: MessageStatus.SENT,
        metadata: {
          autoReply: true,
          automationRunId: run.id,
          automationType: run.trigger,
          flowId: run.flowId,
          entityType: run.entityType,
          entityId: run.entityId,
          status: String(ctx.status || ''),
        },
      },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageText: text, lastMessageAt: new Date() },
    });
  }

  private hasOrderAutomationSent(state: unknown, sentKey: string): boolean {
    if (!state || typeof state !== 'object') return false;
    const sent = (state as Record<string, unknown>).sent;
    if (!sent || typeof sent !== 'object') return false;
    return !!(sent as Record<string, unknown>)[sentKey];
  }

  private parseFlowSteps(steps: unknown): FlowStep[] {
    return (steps as unknown as FlowStep[]) || [];
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

  private matchesQuoteStatusTrigger(
    flow: { trigger: string; conditions: unknown },
    status: string,
  ): boolean {
    if (flow.trigger !== 'quote_status') return false;
    const cond =
      flow.conditions && typeof flow.conditions === 'object'
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
      return `${it.name}, ${price} ${vat}`;
    });
    return template
      .replace(/\{Temsilci Adı\}/g, data.agentName)
      .replace(/\{Sipariş Durumu\}/g, data.status)
      .replace(/\{Ürünler\}/g, lines.join('\n'));
  }

  private renderQuoteTemplate(
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
      return `${it.name}, ${price} ${vat}`;
    });
    return template
      .replace(/\{Temsilci Adı\}/g, data.agentName)
      .replace(/\{Teklif Durumu\}/g, data.status)
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
    const steps = this.parseFlowSteps(flow.steps);
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
      const normalizedChatId = normalizeWhatsappChatId(params.chatId);
      const waResponse = await this.wahaService.sendText(
        params.sessionName,
        normalizedChatId,
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

      this.logger.debug(`Otomatik mesaj gönderildi: ${normalizedChatId}`);
    } catch (err: any) {
      this.logger.error(
        `Otomatik mesaj gönderilemedi (session=${params.sessionName}, chatId=${params.chatId}): ${err.message}`,
      );
    }
  }

  private async executeWait(step: FlowStep) {
    const waitSec = this.readWaitSeconds(step.data);
    await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
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
    const mode = String(step.data?.mode || '').toLowerCase();
    const agentId = step.data?.agentId;

    if (mode === 'round_robin' || !agentId) {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: params.conversationId },
        select: { contact: { select: { organizationId: true } } },
      });
      await this.conversationsService.autoAssignRoundRobin(
        params.conversationId,
        conversation?.contact?.organizationId || undefined,
      );
      return;
    }

    const existing = await this.prisma.assignment.findFirst({
      where: { conversationId: params.conversationId, unassignedAt: null },
    });
    if (existing) return;

    await this.prisma.assignment.create({
      data: { conversationId: params.conversationId, userId: agentId },
    });
  }
}
