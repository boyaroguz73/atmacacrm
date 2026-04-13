import { Injectable, Logger } from '@nestjs/common';
import { AutoReplyService, FlowStep } from './auto-reply.service';
import { WahaService } from '../waha/waha.service';
import { PrismaService } from '../prisma/prisma.service';
import { MessageDirection, MessageStatus } from '@prisma/client';

@Injectable()
export class AutoReplyEngineService {
  private readonly logger = new Logger(AutoReplyEngineService.name);

  constructor(
    private autoReplyService: AutoReplyService,
    private wahaService: WahaService,
    private prisma: PrismaService,
  ) {}

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
    const status = step.data?.status;
    if (!status) return;

    await this.prisma.lead.upsert({
      where: { contactId: params.contactId },
      update: { status },
      create: { contactId: params.contactId, status },
    });
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
