import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiLearningService } from './ai-learning.service';

const AI_ACTIONS = [
  'send_message',
  'ask_question',
  'suggest_product',
  'create_offer',
  'send_offer',
  'create_order',
  'send_payment_link',
  'update_customer_note',
  'assign_tag',
  'handoff_to_human',
] as const;

export type AiAction = (typeof AI_ACTIONS)[number];

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private prisma: PrismaService,
    private learning: AiLearningService,
  ) {}

  // ─── helpers ──────────────────────────────────────────────────────────────

  async resolveOrgId(user: any, queryOrgId?: string): Promise<string> {
    if (queryOrgId) return queryOrgId;
    if (user?.organizationId) return user.organizationId;
    const org = await this.prisma.organization.findFirst({ select: { id: true } });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');
    return org.id;
  }

  // ─── General config ───────────────────────────────────────────────────────

  async getConfig(orgId: string) {
    return this.prisma.aiConfig.upsert({
      where: { organizationId: orgId },
      update: {},
      create: { organizationId: orgId },
    });
  }

  async saveConfig(orgId: string, dto: {
    enabled?: boolean;
    mode?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    openaiKey?: string;
    customerMemoryEnabled?: boolean;
    betaMode?: boolean;
    betaContactIds?: string[];
  }) {
    const data: any = { ...dto };
    if (data.openaiKey === '') data.openaiKey = null;
    if (Array.isArray(data.betaContactIds)) {
      data.betaContactIds = [...new Set(data.betaContactIds.map((v: unknown) => String(v || '').trim()).filter(Boolean))];
    }
    return this.prisma.aiConfig.upsert({
      where: { organizationId: orgId },
      update: data,
      create: { organizationId: orgId, ...data },
    });
  }

  // ─── Action policies ──────────────────────────────────────────────────────

  async getActionPolicies(orgId: string) {
    const existing = await this.prisma.aiActionPolicy.findMany({
      where: { organizationId: orgId },
    });
    const map = Object.fromEntries(existing.map((p) => [p.action, p.mode]));
    return AI_ACTIONS.map((action) => ({
      action,
      mode: (map[action] as string) ?? 'OFF',
    }));
  }

  async saveActionPolicies(
    orgId: string,
    policies: Array<{ action: string; mode: string }>,
  ) {
    await Promise.all(
      policies.map((p) =>
        this.prisma.aiActionPolicy.upsert({
          where: { organizationId_action: { organizationId: orgId, action: p.action } },
          update: { mode: p.mode },
          create: { organizationId: orgId, action: p.action, mode: p.mode },
        }),
      ),
    );
    return this.getActionPolicies(orgId);
  }

  // ─── Business memory ──────────────────────────────────────────────────────

  async getMemory(orgId: string) {
    return this.prisma.aiBusinessMemory.upsert({
      where: { organizationId: orgId },
      update: {},
      create: { organizationId: orgId },
    });
  }

  async saveMemory(orgId: string, dto: {
    rawMemory?: string;
    sector?: string;
    tone?: string;
    salesStyle?: string;
    pricingBehavior?: string;
    objectionPatterns?: string;
    closingPatterns?: string;
  }) {
    return this.prisma.aiBusinessMemory.upsert({
      where: { organizationId: orgId },
      update: dto,
      create: { organizationId: orgId, ...dto },
    });
  }

  async startAnalysis(orgId: string) {
    const config = await this.prisma.aiConfig.findUnique({ where: { organizationId: orgId } });
    if (!config?.openaiKey) throw new BadRequestException('OpenAI API anahtarı girilmemiş');

    await this.prisma.aiBusinessMemory.upsert({
      where: { organizationId: orgId },
      update: { analyzeStatus: 'running', analyzeProgress: 0, analyzeError: null },
      create: { organizationId: orgId, analyzeStatus: 'running', analyzeProgress: 0 },
    });

    // Fire and forget background analysis
    this.runAnalysisBackground(orgId, config.openaiKey).catch((err) => {
      this.logger.error(`Analysis failed for org ${orgId}: ${err.message}`);
    });

    return { started: true };
  }

  private async runAnalysisBackground(orgId: string, openaiKey: string) {
    try {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey: openaiKey });

      await this.prisma.aiBusinessMemory.update({
        where: { organizationId: orgId },
        data: { analyzeProgress: 10 },
      });

      // Fetch last 200 conversations for analysis
      const messages = await this.prisma.message.findMany({
        where: {
          conversation: { session: { organizationId: orgId } },
          body: { not: null },
        },
        orderBy: { timestamp: 'desc' },
        take: 500,
        select: { body: true, direction: true },
      });

      await this.prisma.aiBusinessMemory.update({
        where: { organizationId: orgId },
        data: { analyzeProgress: 30 },
      });

      if (messages.length === 0) {
        await this.prisma.aiBusinessMemory.update({
          where: { organizationId: orgId },
          data: {
            analyzeStatus: 'done',
            analyzeProgress: 100,
            analyzedAt: new Date(),
            rawMemory: 'Analiz edilecek yeterli konuşma bulunamadı.',
          },
        });
        return;
      }

      // Chunk messages
      const sample = messages
        .slice(0, 200)
        .map((m) => `[${m.direction === 'INCOMING' ? 'Müşteri' : 'Operatör'}]: ${m.body}`)
        .join('\n');

      await this.prisma.aiBusinessMemory.update({
        where: { organizationId: orgId },
        data: { analyzeProgress: 50 },
      });

      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Sen bir iş analisti yapay zekasısın. Sana verilen müşteri-operatör konuşma verilerini analiz ederek işletme hakkında yapısal bir özet çıkar.
JSON formatında şu alanları doldur:
{
  "sector": "sektör (e.g., tekstil, elektronik, hizmet)",
  "tone": "iletişim tonu (e.g., resmi, samimi, teknik)",
  "salesStyle": "satış yaklaşımı (e.g., direkt, danışmanlık bazlı, indirim odaklı)",
  "pricingBehavior": "fiyatlandırma davranışı (e.g., liste fiyatı verir, pazarlık kabul eder)",
  "objectionPatterns": "yaygın müşteri itirazları (virgülle ayır)",
  "closingPatterns": "kapanış stratejileri (virgülle ayır)",
  "rawMemory": "işletme hakkında 3-5 cümlelik özet"
}
Sadece JSON döndür, başka açıklama ekleme.`,
          },
          {
            role: 'user',
            content: `İşte son konuşma örnekleri:\n\n${sample}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 800,
      });

      await this.prisma.aiBusinessMemory.update({
        where: { organizationId: orgId },
        data: { analyzeProgress: 90 },
      });

      const raw = completion.choices[0]?.message?.content ?? '{}';
      let parsed: any = {};
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      } catch {
        parsed = { rawMemory: raw };
      }

      await this.prisma.aiBusinessMemory.update({
        where: { organizationId: orgId },
        data: {
          analyzeStatus: 'done',
          analyzeProgress: 100,
          analyzedAt: new Date(),
          sector: parsed.sector ?? null,
          tone: parsed.tone ?? null,
          salesStyle: parsed.salesStyle ?? null,
          pricingBehavior: parsed.pricingBehavior ?? null,
          objectionPatterns: parsed.objectionPatterns ?? null,
          closingPatterns: parsed.closingPatterns ?? null,
          rawMemory: parsed.rawMemory ?? raw,
        },
      });
    } catch (err: any) {
      await this.prisma.aiBusinessMemory.update({
        where: { organizationId: orgId },
        data: {
          analyzeStatus: 'failed',
          analyzeProgress: 0,
          analyzeError: err?.message ?? 'Bilinmeyen hata',
        },
      });
      throw err;
    }
  }

  // ─── Prompts ──────────────────────────────────────────────────────────────

  async getPrompts(orgId: string) {
    return this.prisma.aiPrompt.upsert({
      where: { organizationId: orgId },
      update: {},
      create: { organizationId: orgId },
    });
  }

  async savePrompts(orgId: string, dto: {
    systemPrompt?: string;
    salesPrompt?: string;
    supportPrompt?: string;
    tone?: string;
    customTone?: string;
  }) {
    return this.prisma.aiPrompt.upsert({
      where: { organizationId: orgId },
      update: dto,
      create: { organizationId: orgId, ...dto },
    });
  }

  async generatePromptsFromMemory(orgId: string) {
    const [config, memory, existing] = await Promise.all([
      this.prisma.aiConfig.findUnique({ where: { organizationId: orgId } }),
      this.prisma.aiBusinessMemory.findUnique({ where: { organizationId: orgId } }),
      this.prisma.aiPrompt.findUnique({ where: { organizationId: orgId } }),
    ]);
    if (!config?.openaiKey) throw new BadRequestException('OpenAI API anahtarı girilmemiş');
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: config.openaiKey });
    const mem = {
      sector: memory?.sector ?? '',
      tone: memory?.tone ?? '',
      salesStyle: memory?.salesStyle ?? '',
      pricingBehavior: memory?.pricingBehavior ?? '',
      objectionPatterns: memory?.objectionPatterns ?? '',
      closingPatterns: memory?.closingPatterns ?? '',
      rawMemory: memory?.rawMemory ?? '',
      learnedFaq: Array.isArray(memory?.learnedFaq) ? memory?.learnedFaq : [],
      learnedObjections: Array.isArray(memory?.learnedObjections) ? memory?.learnedObjections : [],
      learnedProducts: Array.isArray(memory?.learnedProducts) ? memory?.learnedProducts : [],
    };

    const completion = await client.chat.completions.create({
      model: config.model ?? 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 1200,
      messages: [
        {
          role: 'system',
          content:
            'Sen CRM için prompt yazan bir uzmansın. Sana işletme hafızası verilecek. Sadece JSON döndür.',
        },
        {
          role: 'user',
          content: `Aşağıdaki hafızayı baz alarak kısa ve etkili promptlar üret:
${JSON.stringify(mem)}

JSON formatı:
{
  "systemPrompt": "...",
  "salesPrompt": "...",
  "supportPrompt": "...",
  "tone": "PROFESSIONAL|FRIENDLY|FORMAL|CASUAL|CUSTOM",
  "customTone": "..."
}`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? '{}';
    let parsed: any = {};
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : raw);
    } catch {
      parsed = {};
    }
    return this.prisma.aiPrompt.upsert({
      where: { organizationId: orgId },
      update: {
        systemPrompt: String(parsed.systemPrompt ?? existing?.systemPrompt ?? ''),
        salesPrompt: String(parsed.salesPrompt ?? existing?.salesPrompt ?? ''),
        supportPrompt: String(parsed.supportPrompt ?? existing?.supportPrompt ?? ''),
        tone: String(parsed.tone ?? existing?.tone ?? 'PROFESSIONAL').toUpperCase(),
        customTone: String(parsed.customTone ?? existing?.customTone ?? ''),
      },
      create: {
        organizationId: orgId,
        systemPrompt: String(parsed.systemPrompt ?? ''),
        salesPrompt: String(parsed.salesPrompt ?? ''),
        supportPrompt: String(parsed.supportPrompt ?? ''),
        tone: String(parsed.tone ?? 'PROFESSIONAL').toUpperCase(),
        customTone: String(parsed.customTone ?? ''),
      },
    });
  }

  // ─── Automation rules ─────────────────────────────────────────────────────

  async getRules(orgId: string) {
    return this.prisma.aiAutomationRule.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createRule(orgId: string, dto: { trigger: string; enabled?: boolean; config?: any }) {
    return this.prisma.aiAutomationRule.create({
      data: {
        organizationId: orgId,
        trigger: dto.trigger,
        enabled: dto.enabled ?? true,
        config: dto.config ?? {},
      },
    });
  }

  async updateRule(orgId: string, ruleId: string, dto: { enabled?: boolean; config?: any }) {
    const rule = await this.prisma.aiAutomationRule.findFirst({
      where: { id: ruleId, organizationId: orgId },
    });
    if (!rule) throw new NotFoundException('Kural bulunamadı');
    return this.prisma.aiAutomationRule.update({ where: { id: ruleId }, data: dto });
  }

  async deleteRule(orgId: string, ruleId: string) {
    const rule = await this.prisma.aiAutomationRule.findFirst({
      where: { id: ruleId, organizationId: orgId },
    });
    if (!rule) throw new NotFoundException('Kural bulunamadı');
    await this.prisma.aiAutomationRule.delete({ where: { id: ruleId } });
    return { deleted: true };
  }

  // ─── Pending actions ──────────────────────────────────────────────────────

  async getPendingActions(orgId: string, status?: string, paging?: { skip?: number; take?: number }) {
    const where = { organizationId: orgId, ...(status ? { status } : {}) };
    const [total, items] = await Promise.all([
      this.prisma.aiPendingAction.count({ where }),
      this.prisma.aiPendingAction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: paging?.skip ?? 0,
        take: paging?.take ?? 25,
      }),
    ]);
    return { total, items };
  }

  async reviewPendingAction(
    orgId: string,
    id: string,
    dto: { decision: 'APPROVED' | 'REJECTED'; reviewedById?: string },
  ) {
    const action = await this.prisma.aiPendingAction.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!action) throw new NotFoundException('İşlem bulunamadı');
    if (action.status !== 'PENDING')
      throw new BadRequestException('Bu işlem zaten incelendi');

    return this.prisma.aiPendingAction.update({
      where: { id },
      data: {
        status: dto.decision,
        reviewedById: dto.reviewedById ?? null,
        reviewedAt: new Date(),
      },
    });
  }

  // ─── Logs ─────────────────────────────────────────────────────────────────

  async getLogs(orgId: string, filters: {
    action?: string;
    status?: string;
    contactId?: string;
    from?: string;
    to?: string;
    skip?: number;
    take?: number;
  }) {
    const where: any = { organizationId: orgId };
    if (filters.action) where.action = filters.action;
    if (filters.status) where.status = filters.status;
    if (filters.contactId) where.contactId = filters.contactId;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }

    const [total, itemsRaw] = await Promise.all([
      this.prisma.aiLog.count({ where }),
      this.prisma.aiLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? 50,
      }),
    ]);
    const items = itemsRaw.map((it) => {
      let parsedInput: any = null;
      let parsedOutput: any = null;
      try { parsedInput = it.input ? JSON.parse(it.input) : null; } catch {}
      try { parsedOutput = it.output ? JSON.parse(it.output) : null; } catch {}
      return { ...it, parsedInput, parsedOutput };
    });
    return { total, items };
  }

  async getReports(orgId: string, filters: { from?: string; to?: string }) {
    const dateWhere =
      filters.from || filters.to
        ? {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(filters.to) } : {}),
          }
        : undefined;
    const messageWhere: any = { conversation: { session: { organizationId: orgId } } };
    if (dateWhere) messageWhere.timestamp = dateWhere;
    const orderWhere: any = { contact: { organizationId: orgId } };
    if (dateWhere) orderWhere.createdAt = dateWhere;
    const quoteWhere: any = { contact: { organizationId: orgId } };
    if (dateWhere) quoteWhere.createdAt = dateWhere;
    const logWhere: any = { organizationId: orgId };
    if (dateWhere) logWhere.createdAt = dateWhere;

    const [
      talkedContacts,
      incomingMessages,
      outgoingMessages,
      offersCreated,
      ordersCreated,
      ordersToAccounting,
      aiActionStats,
    ] = await Promise.all([
      this.prisma.message.findMany({
        where: messageWhere,
        select: { conversation: { select: { contactId: true } } },
        distinct: ['conversationId'],
      }).then((rows) => new Set(rows.map((r) => r.conversation?.contactId).filter(Boolean)).size),
      this.prisma.message.count({ where: { ...messageWhere, direction: 'INCOMING' } }),
      this.prisma.message.count({ where: { ...messageWhere, direction: 'OUTGOING' } }),
      this.prisma.quote.count({ where: quoteWhere }),
      this.prisma.salesOrder.count({ where: orderWhere }),
      this.prisma.salesOrder.count({ where: { ...orderWhere, invoice: { isNot: null } } }),
      this.prisma.aiLog.groupBy({
        by: ['action'],
        _count: { _all: true },
        where: logWhere,
      }),
    ]);

    return {
      talkedContacts,
      incomingMessages,
      outgoingMessages,
      offersCreated,
      ordersCreated,
      ordersToAccounting,
      actionBreakdown: aiActionStats.map((x) => ({ action: x.action, count: x._count._all })),
    };
  }

  // ─── Test connection ──────────────────────────────────────────────────────

  async testConnection(orgId: string) {
    const config = await this.prisma.aiConfig.findUnique({ where: { organizationId: orgId } });
    if (!config?.openaiKey) throw new BadRequestException('OpenAI API anahtarı girilmemiş');

    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: config.openaiKey });

    const completion = await client.chat.completions.create({
      model: config.model ?? 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Merhaba, bağlantı testi.' }],
      max_tokens: 10,
    });

    return {
      ok: true,
      model: completion.model,
      usage: completion.usage,
    };
  }

  // ─── Learning (delegate to AiLearningService) ─────────────────────────────

  async startLearning(orgId: string) {
    return this.learning.startLearning(orgId);
  }

  async getLearningStatus(orgId: string) {
    return this.learning.getLearningStatus(orgId);
  }

  async getLearningData(orgId: string) {
    const mem = await this.prisma.aiBusinessMemory.findUnique({ where: { organizationId: orgId } });
    return {
      learnedFaq: mem?.learnedFaq ?? [],
      learnedProducts: mem?.learnedProducts ?? [],
      learnedObjections: mem?.learnedObjections ?? [],
      learnedAt: mem?.learnedAt ?? null,
      learningStatus: mem?.learningStatus ?? 'idle',
    };
  }
}
