import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WahaService } from '../waha/waha.service';
import { AiIntentRouterService } from './ai-intent-router.service';
import { MessagesService } from '../messages/messages.service';

export interface AiMessageContext {
  orgId: string;
  sessionName: string;
  conversationId: string;
  contactId: string;
  waMessageId?: string;
  messageBody: string;
}

interface ScrapedProduct {
  url: string;
  name?: string;
  description?: string;
  price?: string;
  imageUrl?: string;
  sku?: string;
  pastConversations?: string[];
}

@Injectable()
export class AiEngineService {
  private readonly logger = new Logger(AiEngineService.name);

  private addBusinessDays(startDate: Date, businessDays: number): Date {
    const d = new Date(startDate);
    let added = 0;
    while (added < businessDays) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) added += 1;
    }
    return d;
  }

  constructor(
    private prisma: PrismaService,
    private waha: WahaService,
    private intentRouter: AiIntentRouterService,
    private messagesService: MessagesService,
  ) {}

  // ─── Entry point ──────────────────────────────────────────────────────────

  async processIncomingMessage(ctx: AiMessageContext): Promise<void> {
    const incomingHash = `${ctx.conversationId}:${ctx.waMessageId || ctx.messageBody}`.slice(0, 500);
    const duplicateTurn = await this.prisma.aiLog.findFirst({
      where: {
        organizationId: ctx.orgId,
        conversationId: ctx.conversationId,
        action: 'ai_engine_turn',
        status: 'SUCCESS',
        input: incomingHash,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (duplicateTurn) {
      this.logger.debug(`Skip duplicate AI turn for conv=${ctx.conversationId}`);
      return;
    }
    // 1. Check if AI is enabled
    const config = await this.prisma.aiConfig.findUnique({
      where: { organizationId: ctx.orgId },
    });
    if (!config?.enabled || !config?.openaiKey) return;

    // 2. Beta modu: sadece izin verilen kişilere yanıt ver
    if (config.betaMode) {
      const normalizePhone = (v: string) => String(v || '').replace(/[^\d]/g, '');
      const betaListRaw: string[] = Array.isArray(config.betaContactIds) ? config.betaContactIds as string[] : [];
      const betaList = [...new Set(betaListRaw.map((v) => String(v || '').trim()).filter(Boolean))];
      if (betaList.length === 0) return; // beta açık ama liste boş → hiç yanıt verme
      const contact = await this.prisma.contact.findUnique({
        where: { id: ctx.contactId },
        select: { id: true, phone: true },
      });
      const phone = normalizePhone(contact?.phone || '');
      const allowed =
        betaList.includes(ctx.contactId) ||
        (phone && betaList.some((entry) => normalizePhone(entry) === phone));
      if (!allowed) return;
    }

    // 3. Don't process if conversation is closed
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
      select: { isClosed: true, isGroup: true },
    });
    if (!conversation || conversation.isClosed || conversation.isGroup) return;

    // 3. Get action policies
    const policies = await this.prisma.aiActionPolicy.findMany({
      where: { organizationId: ctx.orgId },
    });
    const policyMap = Object.fromEntries(policies.map((p) => [p.action, p.mode]));
    const getPolicy = (action: string) => (policyMap[action] as string) ?? 'OFF';

    // 4. Build context
    const [history, contact, memory, prompts, allProducts] = await Promise.all([
      this.getHistory(ctx.conversationId),
      this.prisma.contact.findUnique({
        where: { id: ctx.contactId },
        select: { id: true, name: true, surname: true, phone: true, tags: true, notes: true, company: true },
      }),
      this.prisma.aiBusinessMemory.findUnique({ where: { organizationId: ctx.orgId } }),
      this.prisma.aiPrompt.findUnique({ where: { organizationId: ctx.orgId } }),
      // Tüm aktif ürünler — sadece id + name + fiyat (katalog index olarak)
      this.prisma.product.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, unitPrice: true, currency: true, category: true },
      }),
    ]);

    const products = await this.getRelevantProducts(ctx.messageBody, memory);

    /** SAFE modunda her zaman tam katalog; diğerlerinde hafif niyet sınıflandırıcı ile token tasarrufu */
    const mode = String(config.mode || 'BALANCED').toUpperCase();
    let attachFullCatalog = true;
    if (mode !== 'SAFE' && config.openaiKey) {
      const { intent } = await this.intentRouter.classify(
        config.openaiKey,
        config.model ?? 'gpt-4o-mini',
        ctx.messageBody,
      );
      attachFullCatalog = this.intentRouter.shouldAttachFullCatalog(intent);
      if (!attachFullCatalog) {
        this.logger.debug(`AI intent=${intent} → katalog özeti kısaltıldı`);
      }
    }

    // 4b. URL'den ürün çek + geçmiş konuşmalardan benzer soruları bul
    const urls = this.extractUrls(ctx.messageBody);
    let scrapedContext: ScrapedProduct[] = [];
    if (urls.length > 0) {
      const scraped = await Promise.all(urls.slice(0, 2).map((u) => this.scrapeProductFromUrl(u)));
      scrapedContext = scraped.filter((s): s is ScrapedProduct => s !== null);

      // Scraped ürün adıyla DB'den eşleştir — bulunursa products listesine ekle
      for (const sp of scrapedContext) {
        if (sp.name) {
          const nameWords = sp.name.split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
          const matched = await this.prisma.product.findMany({
            where: {
              isActive: true,
              OR: nameWords.map((w) => ({ name: { contains: w, mode: 'insensitive' as const } })),
            },
            take: 5,
            select: { id: true, name: true, description: true, unitPrice: true, currency: true, stock: true, category: true, sku: true },
          });
          for (const m of matched) {
            if (!products.find((p: any) => p.id === m.id)) products.push(m);
          }
        }
      }

      // O ürün hakkında daha önce sorulan konuşmalardan bağlam çek
      for (const sp of scrapedContext) {
        if (sp.name) {
          const nameWord = sp.name.split(/\s+/).slice(0, 3).join(' ');
          const pastMsgs = await this.prisma.message.findMany({
            where: {
              conversation: { session: { organizationId: ctx.orgId } },
              body: { contains: nameWord, mode: 'insensitive' },
              conversationId: { not: ctx.conversationId }, // başka konuşmalar
            },
            orderBy: { timestamp: 'desc' },
            take: 10,
            select: { body: true, direction: true },
          });
          if (pastMsgs.length > 0) {
            sp.pastConversations = pastMsgs.map(
              (m) => `[${m.direction === 'INCOMING' ? 'Müşteri' : 'Operatör'}]: ${m.body}`,
            );
          }
        }
      }
    }

    // 5. Build system prompt
    const systemPrompt = this.buildSystemPrompt(
      config,
      memory,
      prompts,
      contact,
      products,
      scrapedContext,
      allProducts,
      attachFullCatalog,
    );

    // 6. Build tool definitions (only include tools whose policy != OFF)
    const tools = this.buildTools(policyMap);

    // 7. OpenAI — çok adımlı araç döngüsü (tool sonuçlarını modele geri verir)
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: config.openaiKey });

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: ctx.messageBody },
    ];

    const maxRounds = Math.min(
      Math.max(parseInt(String(process.env.AI_MAX_TOOL_ROUNDS || '6'), 10) || 6, 1),
      10,
    );
    let usageAgg = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const engineStarted = Date.now();

    try {
      for (let round = 0; round < maxRounds; round++) {
        let response: any;
        try {
          response = await client.chat.completions.create({
            model: config.model ?? 'gpt-4o-mini',
            messages,
            tools,
            tool_choice: 'auto',
            temperature: config.temperature ?? 0.7,
            max_tokens: config.maxTokens ?? 500,
          });
        } catch (err: any) {
          this.logger.error(`OpenAI error for org ${ctx.orgId}: ${err.message}`);
          await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, 'send_message', 'FAILED', null, err.message);
          return;
        }

        if (response.usage) {
          usageAgg.prompt_tokens += response.usage.prompt_tokens ?? 0;
          usageAgg.completion_tokens += response.usage.completion_tokens ?? 0;
          usageAgg.total_tokens += response.usage.total_tokens ?? 0;
        }

        const choice = response.choices[0];
        if (!choice?.message) break;

        if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
          messages.push(choice.message);
          let askSent = false;
          for (const toolCall of choice.message.tool_calls) {
            const action = toolCall.function.name;
            let args: any = {};
            try {
              args = JSON.parse(toolCall.function.arguments || '{}');
            } catch {
              /* ignore */
            }
            const { content, askSent: nextAsk } = await this.dispatchActionWithToolResult(
              ctx,
              action,
              args,
              getPolicy(action),
              config,
              askSent,
            );
            askSent = nextAsk;
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: String(content).slice(0, 12_000),
            });
          }
          continue;
        }

        const text = choice.message.content?.trim();
        if (text) {
          await this.executeSendMessage(ctx, text, getPolicy('send_message'), config);
        }

        await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, 'ai_engine_turn', 'SUCCESS', {
          rounds: round + 1,
          usage: usageAgg,
          durationMs: Date.now() - engineStarted,
        }, undefined, undefined, incomingHash);
        return;
      }

      this.logger.warn(`AI max tool rounds (${maxRounds}) reached for conv ${ctx.conversationId}`);
      await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, 'ai_engine_turn', 'FAILED', {
        reason: 'max_rounds',
        usage: usageAgg,
      });
    } catch (loopErr: any) {
      this.logger.error(`AI engine loop error: ${loopErr?.message}`);
    }
  }

  // ─── Action dispatcher (tool döngüsü için araç çıktısı döner) ─────────────

  private async dispatchActionWithToolResult(
    ctx: AiMessageContext,
    action: string,
    args: any,
    policy: string,
    config: any,
    askAlreadySent: boolean,
  ): Promise<{ content: string; askSent: boolean }> {
    if (policy === 'OFF') {
      return {
        content: JSON.stringify({ ok: false, action, skipped: 'policy_off' }),
        askSent: askAlreadySent,
      };
    }

    if (policy === 'ASK') {
      await this.queuePendingAction(ctx, action, args);
      let sent = askAlreadySent;
      if (!askAlreadySent) {
        const actionLabels: Record<string, string> = {
          create_order: 'Sipariş talebiniz alındı, onaylandıktan sonra işleme alınacaktır.',
          create_offer: 'Teklif talebiniz alındı, hazırlandıktan sonra size iletilecektir.',
          send_offer: 'Teklif gönderme talebiniz alındı.',
          send_payment_link: 'Ödeme linki talebiniz alındı.',
          update_customer_note: 'Bilgileriniz güncelleme için alındı.',
          assign_tag: 'Talebiniz alındı.',
          handoff_to_human: 'Müşteri temsilcimize bağlanıyorsunuz, kısa süre içinde dönüş yapılacaktır.',
        };
        const infoMsg = actionLabels[action] ?? 'Talebiniz alındı, kısa süre içinde size dönüş yapılacaktır.';
        await this.sendWhatsApp(ctx, infoMsg, config);
        sent = true;
      }
      return {
        content: JSON.stringify({ ok: true, pendingApproval: true, action }),
        askSent: sent,
      };
    }

    try {
      switch (action) {
        case 'send_message':
          await this.sendWhatsApp(ctx, args.text, config);
          await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, action, 'SUCCESS', args);
          return {
            content: JSON.stringify({ ok: true, action: 'send_message', delivered: true }),
            askSent: askAlreadySent,
          };

        case 'ask_question':
          await this.sendWhatsApp(ctx, args.question, config);
          await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, action, 'SUCCESS', args);
          return {
            content: JSON.stringify({ ok: true, action: 'ask_question', delivered: true }),
            askSent: askAlreadySent,
          };

        case 'suggest_product':
          await this.executeSuggestProduct(ctx, args, config);
          return {
            content: JSON.stringify({
              ok: true,
              action: 'suggest_product',
              productIds: args.productIds ?? [],
            }),
            askSent: askAlreadySent,
          };

        case 'create_offer':
          await this.executeCreateOffer(ctx, args, config);
          return {
            content: JSON.stringify({ ok: true, action: 'create_offer' }),
            askSent: askAlreadySent,
          };

        case 'send_offer':
          await this.executeSendOffer(ctx, args, config);
          return {
            content: JSON.stringify({ ok: true, action: 'send_offer', quoteId: args.quoteId }),
            askSent: askAlreadySent,
          };

        case 'create_order':
          await this.executeCreateOrder(ctx, args, config);
          return {
            content: JSON.stringify({ ok: true, action: 'create_order' }),
            askSent: askAlreadySent,
          };

        case 'send_payment_link':
          await this.executeSendPaymentLink(ctx, args, config);
          return {
            content: JSON.stringify({ ok: true, action: 'send_payment_link' }),
            askSent: askAlreadySent,
          };

        case 'update_customer_note':
          await this.executeUpdateNote(ctx, args);
          return {
            content: JSON.stringify({ ok: true, action: 'update_customer_note' }),
            askSent: askAlreadySent,
          };

        case 'assign_tag':
          await this.executeAssignTag(ctx, args);
          return {
            content: JSON.stringify({ ok: true, action: 'assign_tag', tag: args.tag }),
            askSent: askAlreadySent,
          };

        case 'handoff_to_human':
          await this.executeHandoff(ctx, args, config);
          return {
            content: JSON.stringify({ ok: true, action: 'handoff_to_human' }),
            askSent: askAlreadySent,
          };

        default:
          this.logger.warn(`Unknown AI action: ${action}`);
          return {
            content: JSON.stringify({ ok: false, unknownAction: action }),
            askSent: askAlreadySent,
          };
      }
    } catch (err: any) {
      this.logger.error(`AI action ${action} failed: ${err.message}`);
      await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, action, 'FAILED', args, err.message);
      return {
        content: JSON.stringify({ ok: false, action, error: err.message }),
        askSent: askAlreadySent,
      };
    }
  }

  // ─── Action executors ────────────────────────────────────────────────────

  private async executeSendMessage(ctx: AiMessageContext, text: string, policy: string, config: any) {
    if (policy === 'OFF') return;
    if (policy === 'ASK') {
      await this.queuePendingAction(ctx, 'send_message', { text });
      return;
    }
    await this.sendWhatsApp(ctx, text, config);
    await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, 'send_message', 'SUCCESS', { text });
  }

  private async executeSuggestProduct(ctx: AiMessageContext, args: any, config: any) {
    const productIds: string[] = Array.isArray(args.productIds) ? args.productIds : [];
    const message: string = args.message ?? '';

    const products = productIds.length > 0
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds }, isActive: true },
          select: { id: true, name: true, unitPrice: true, currency: true, imageUrl: true, description: true, stock: true, sku: true },
        })
      : [];

    const botUser = await this.getOrgBotUser(ctx.orgId);
    if (!botUser) {
      // fallback: eski davranış (sadece metin), bot user yoksa ürün kartı gönderemeyiz
      let productText = message ? `${message}\n\n` : '';
      for (const p of products) {
        productText += `📦 *${p.name}*\n`;
        productText += `💰 ${p.unitPrice.toLocaleString('tr-TR')} ${p.currency}`;
        if (p.stock != null) productText += ` | Stok: ${p.stock}`;
        if (p.description) productText += `\n${p.description}`;
        productText += '\n\n';
      }
      if (productText.trim()) {
        await this.sendWhatsApp(ctx, productText.trim(), config);
      }
      await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, 'suggest_product', 'SUCCESS', {
        productIds,
        message,
        transport: 'text_fallback_no_bot_user',
      });
      return;
    }

    // Ön mesaj (opsiyonel)
    if (String(message || '').trim()) {
      await this.sendWhatsApp(ctx, String(message).trim(), config);
    }

    // Chat ile aynı ürün paylaşım mekanizması: MessagesService.sendProductShare
    for (const pid of productIds) {
      await this.messagesService.sendProductShare({
        conversationId: ctx.conversationId,
        productId: pid,
        sentById: botUser.id,
      });
    }

    await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, 'suggest_product', 'SUCCESS', {
      productIds,
      message,
      transport: 'messages.sendProductShare',
    });
  }

  private async executeCreateOffer(ctx: AiMessageContext, args: any, config: any) {
    const botUser = await this.getOrgBotUser(ctx.orgId);
    if (!botUser) {
      this.logger.warn(`No bot user found for org ${ctx.orgId}`);
      return;
    }

    const rawItems: Array<{ name: string; qty: number; unitPrice: number; productId?: string }> =
      Array.isArray(args.items) ? args.items : [];
    if (rawItems.length === 0) return;

    // Calculate totals inline (no QuotesService dependency)
    const VAT_RATE = 20;
    let subtotal = 0;
    let vatTotal = 0;
    const lineItems = rawItems.map((item) => {
      const qty = item.qty ?? 1;
      const gross = item.unitPrice * qty; // price already includes VAT
      const ex = gross / (1 + VAT_RATE / 100);
      const vat = gross - ex;
      subtotal += ex;
      vatTotal += vat;
      return {
        name: item.name,
        quantity: qty,
        unitPrice: item.unitPrice,
        vatRate: VAT_RATE,
        priceIncludesVat: true,
        lineTotal: Math.round(gross * 100) / 100,
        productId: item.productId ?? null,
      };
    });
    const grandTotal = Math.round((subtotal + vatTotal) * 100) / 100;

    const quote = await this.prisma.quote.create({
      data: {
        contactId: ctx.contactId,
        createdById: botUser.id,
        currency: 'TRY',
        discountType: 'PERCENT',
        discountValue: 0,
        discountTotal: 0,
        subtotal: Math.round(subtotal * 100) / 100,
        vatTotal: Math.round(vatTotal * 100) / 100,
        grandTotal,
        validUntil: this.addBusinessDays(new Date(), 5),
        notes: args.note ?? null,
        items: {
          create: lineItems.map((li) => ({
            name: li.name,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            vatRate: li.vatRate,
            priceIncludesVat: li.priceIncludesVat,
            lineTotal: li.lineTotal,
            discountValue: 0,
            ...(li.productId ? { productId: li.productId } : {}),
          })),
        },
      },
      select: { id: true, quoteNumber: true, grandTotal: true, currency: true },
    });

    // Teklif oluşturulduktan sonra aynı send_offer mekanizmasını kullanarak müşteriye ilet.
    await this.executeSendOffer(ctx, { quoteId: quote.id }, config);
    await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, 'create_offer', 'SUCCESS', { quoteId: quote.id, quoteNumber: quote.quoteNumber });
  }

  private async executeSendOffer(ctx: AiMessageContext, args: any, config: any) {
    const quoteId: string = args.quoteId;
    if (!quoteId) return;

    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, contactId: ctx.contactId },
      select: { id: true, quoteNumber: true, grandTotal: true, currency: true, pdfUrl: true },
    });
    if (!quote) return;

    const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
    const pdfLink = quote.pdfUrl
      ? (quote.pdfUrl.startsWith('http') ? quote.pdfUrl : `${baseUrl}${quote.pdfUrl}`)
      : `${baseUrl}/api/quotes/${quote.id}/pdf`;

    const msg = `📄 Teklif #${quote.quoteNumber}\nTutar: *${quote.grandTotal.toLocaleString('tr-TR')} ${quote.currency}*\n\n${pdfLink}`;
    await this.sendWhatsApp(ctx, msg, config);
    await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, 'send_offer', 'SUCCESS', { quoteId });
  }

  private async executeCreateOrder(ctx: AiMessageContext, args: any, config: any) {
    const botUser = await this.getOrgBotUser(ctx.orgId);
    if (!botUser) return;

    const items: Array<{ name: string; qty: number; unitPrice: number; productId?: string }> =
      Array.isArray(args.items) ? args.items : [];
    if (items.length === 0) return;

    const grandTotal = items.reduce((sum, i) => sum + (i.unitPrice * (i.qty ?? 1)), 0);

    const order = await this.prisma.salesOrder.create({
      data: {
        contactId: ctx.contactId,
        createdById: botUser.id,
        notes: args.note ?? null,
        subtotal: grandTotal,
        vatTotal: 0,
        grandTotal,
        items: {
          create: items.map((item) => ({
            name: item.name,
            quantity: item.qty ?? 1,
            unitPrice: item.unitPrice,
            vatRate: 20,
            lineTotal: item.unitPrice * (item.qty ?? 1),
            ...(item.productId ? { productId: item.productId } : {}),
          })),
        },
      },
      select: { id: true, orderNumber: true, grandTotal: true },
    });

    // AI sipariş oluşturduğunda müşteri durumu otomatik "Kazanıldı" (WON) olsun.
    try {
      const lead = await this.prisma.lead.findUnique({
        where: { contactId: ctx.contactId },
        select: { id: true, status: true },
      });
      if (!lead) {
        await this.prisma.lead.create({
          data: { contactId: ctx.contactId, status: 'WON', closedAt: new Date() },
        });
      } else if (lead.status !== 'WON') {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { status: 'WON', closedAt: new Date(), lossReason: null },
        });
      }
    } catch (err: any) {
      this.logger.warn(`AI sipariş sonrası lead WON güncellemesi başarısız: ${err?.message || err}`);
    }

    const msg = `✅ Siparişiniz oluşturuldu.\nSipariş No: *#${order.orderNumber}*\nToplam: *${order.grandTotal.toLocaleString('tr-TR')} TRY*`;
    await this.sendWhatsApp(ctx, msg, config);
    await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, 'create_order', 'SUCCESS', { orderId: order.id, orderNumber: order.orderNumber });
  }

  private async executeSendPaymentLink(ctx: AiMessageContext, args: any, config: any) {
    const { amount, description } = args;
    // Simple payment link format — extend with Iyzico/etc. as needed
    const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
    const link = `${baseUrl}/payment?amount=${amount}&desc=${encodeURIComponent(description ?? '')}&contact=${ctx.contactId}`;
    const msg = `💳 Ödeme linkiniz:\n${description ?? ''}\nTutar: *${Number(amount).toLocaleString('tr-TR')} TRY*\n\n${link}`;
    await this.sendWhatsApp(ctx, msg, config);
    await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, 'send_payment_link', 'SUCCESS', { amount, description });
  }

  private async executeUpdateNote(ctx: AiMessageContext, args: any) {
    const note: string = args.note ?? '';
    await this.prisma.contact.update({
      where: { id: ctx.contactId },
      data: { notes: note },
    });
    await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, 'update_customer_note', 'SUCCESS', { note });
  }

  private async executeAssignTag(ctx: AiMessageContext, args: any) {
    const tag: string = args.tag ?? '';
    if (!tag) return;
    const contact = await this.prisma.contact.findUnique({
      where: { id: ctx.contactId },
      select: { tags: true },
    });
    const existing: string[] = contact?.tags ?? [];
    if (!existing.includes(tag)) {
      await this.prisma.contact.update({
        where: { id: ctx.contactId },
        data: { tags: [...existing, tag] },
      });
    }
    await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, 'assign_tag', 'SUCCESS', { tag });
  }

  private async executeHandoff(ctx: AiMessageContext, args: any, config: any) {
    const reason: string = args.reason ?? '';
    // Remove any AI assignment flag — normal agents will pick up
    const msg = `Sizi bir müşteri temsilcimize bağlıyorum, lütfen bekleyiniz.${reason ? `\nKonu: ${reason}` : ''}`;
    await this.sendWhatsApp(ctx, msg, config);
    await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, 'handoff_to_human', 'SUCCESS', { reason });
  }

  // ─── Execute approved pending action ────────────────────────────────────

  async executeApprovedAction(pendingAction: {
    id: string;
    organizationId: string;
    conversationId: string | null;
    contactId: string | null;
    action: string;
    payload: any;
  }): Promise<void> {
    const config = await this.prisma.aiConfig.findUnique({
      where: { organizationId: pendingAction.organizationId },
    });
    if (!config?.openaiKey) return;

    const ctx: AiMessageContext = {
      orgId: pendingAction.organizationId,
      sessionName: '',   // will be resolved inside sendWhatsApp via conversationId
      conversationId: pendingAction.conversationId ?? '',
      contactId: pendingAction.contactId ?? '',
      messageBody: '',
    };

    const payload = typeof pendingAction.payload === 'object' && pendingAction.payload !== null
      ? pendingAction.payload
      : {};

    try {
      switch (pendingAction.action) {
        case 'send_message':
          await this.sendWhatsApp(ctx, payload.text ?? '', config);
          await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, pendingAction.action, 'SUCCESS', payload);
          break;

        case 'ask_question':
          await this.sendWhatsApp(ctx, payload.question ?? '', config);
          await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, pendingAction.action, 'SUCCESS', payload);
          break;

        case 'suggest_product':
          await this.executeSuggestProduct(ctx, payload, config);
          break;

        case 'create_offer':
          await this.executeCreateOffer(ctx, payload, config);
          break;

        case 'send_offer':
          await this.executeSendOffer(ctx, payload, config);
          break;

        case 'create_order':
          await this.executeCreateOrder(ctx, payload, config);
          break;

        case 'send_payment_link':
          await this.executeSendPaymentLink(ctx, payload, config);
          break;

        case 'update_customer_note':
          await this.executeUpdateNote(ctx, payload);
          break;

        case 'assign_tag':
          await this.executeAssignTag(ctx, payload);
          break;

        case 'handoff_to_human':
          await this.executeHandoff(ctx, payload, config);
          break;

        default:
          this.logger.warn(`executeApprovedAction: unknown action ${pendingAction.action}`);
      }
    } catch (err: any) {
      this.logger.error(`executeApprovedAction failed for action ${pendingAction.action}: ${err.message}`);
      await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, pendingAction.action, 'FAILED', payload, err.message);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async sendWhatsApp(ctx: AiMessageContext, text: string, config: any) {
    const session = await this.getSessionName(ctx.conversationId);
    const contact = await this.prisma.contact.findUnique({
      where: { id: ctx.contactId },
      select: { phone: true },
    });
    if (!session || !contact?.phone) return;
    await this.waha.sendText(session, `${contact.phone}@c.us`, text);
  }

  private async getSessionName(conversationId: string): Promise<string | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { session: { select: { name: true } } },
    });
    return conv?.session?.name ?? null;
  }

  private async getOrgBotUser(orgId: string) {
    return this.prisma.user.findFirst({
      where: { organizationId: orgId, role: 'ADMIN', isActive: true },
      select: { id: true },
    });
  }

  private async getHistory(conversationId: string) {
    const msgs = await this.prisma.message.findMany({
      where: { conversationId, body: { not: null } },
      orderBy: { timestamp: 'desc' },
      take: 20,
      select: { body: true, direction: true },
    });
    return msgs.reverse().map((m) => ({
      role: m.direction === 'INCOMING' ? 'user' : 'assistant',
      content: m.body!,
    }));
  }

  /**
   * Tüm kataloğu göndermek yerine mesaj içeriğini analiz ederek
   * yalnızca ilgili ürünleri döndürür. Maliyet: 0 ek API çağrısı.
   *
   * Öncelik sırası:
   * 1. Öğrenme motorunun keyword→productId eşleştirmeleri (learnedProducts)
   * 2. DB text araması (name / category ILIKE)
   * 3. Hiç eşleşme yoksa son eklenen 15 aktif ürün
   */
  private async getRelevantProducts(messageBody: string, memory: any): Promise<any[]> {
    const TR_STOPWORDS = new Set([
      'bir', 'bu', 'şu', 'ile', 'için', 'veya', 'bile', 'daha', 'gibi',
      'bunu', 'bana', 'sana', 'evet', 'hayır', 'nasıl', 'nedir', 'hangi',
      'kadar', 'olan', 'olur', 'oldu', 'eder', 'etmek', 'yapmak', 'almak',
      'vermek', 'lütfen', 'merhaba', 'teşekkür', 'iyi', 'var', 'yok',
      'ben', 'sen', 'biz', 'siz', 'ama', 'fakat', 'ancak', 'çok', 'az',
    ]);

    const words = messageBody
      .toLowerCase()
      .replace(/[^a-zçğışöüa-z0-9\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !TR_STOPWORDS.has(w));

    if (words.length === 0) return this.getFallbackProducts();

    // ── 1. Öğrenilmiş keyword eşleştirmeleri ──────────────────────────────
    const learnedIds = new Set<string>();
    if (memory?.learnedProducts && Array.isArray(memory.learnedProducts)) {
      for (const entry of memory.learnedProducts as Array<{ keyword: string; productIds: string[] }>) {
        if (words.some((w) => entry.keyword?.toLowerCase().includes(w) || w.includes(entry.keyword?.toLowerCase()))) {
          for (const id of (entry.productIds ?? [])) learnedIds.add(id);
        }
      }
    }

    // ── 2. DB text araması ─────────────────────────────────────────────────
    const dbResults = await this.prisma.product.findMany({
      where: {
        isActive: true,
        OR: words.flatMap((w) => [
          { name: { contains: w, mode: 'insensitive' as const } },
          { category: { contains: w, mode: 'insensitive' as const } },
          { description: { contains: w, mode: 'insensitive' as const } },
        ]),
      },
      orderBy: { name: 'asc' },
      take: 30,
      select: { id: true, name: true, description: true, unitPrice: true, currency: true, stock: true, category: true, sku: true },
    });

    // ── 3. Learned-id ürünleri ekle ────────────────────────────────────────
    let extra: any[] = [];
    if (learnedIds.size > 0) {
      const dbIds = new Set(dbResults.map((p) => p.id));
      const missing = [...learnedIds].filter((id) => !dbIds.has(id));
      if (missing.length > 0) {
        extra = await this.prisma.product.findMany({
          where: { id: { in: missing }, isActive: true },
          select: { id: true, name: true, description: true, unitPrice: true, currency: true, stock: true, category: true, sku: true },
        });
      }
    }

    const combined = [...dbResults, ...extra];
    if (combined.length > 0) return combined;

    // ── 4. Fallback ────────────────────────────────────────────────────────
    return this.getFallbackProducts();
  }

  // ─── URL detection & web scraping ────────────────────────────────────────

  private extractUrls(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s]+/g) ?? [];
    // Temizle: sondaki noktalama işaretlerini at
    return matches.map((u) => u.replace(/[.,!?)]+$/, ''));
  }

  private async scrapeProductFromUrl(url: string): Promise<ScrapedProduct | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AtmacaCRM/1.0; +https://atmacaofis.com)',
          'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        },
      });
      clearTimeout(timeout);
      if (!res.ok) return null;

      const html = await res.text();

      // ── 1. JSON-LD (schema.org/Product) ──────────────────────────────────
      const jsonLdBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
      for (const block of jsonLdBlocks) {
        const content = block.replace(/<script[^>]*>|<\/script>/gi, '').trim();
        try {
          const data = JSON.parse(content);
          const items: any[] = Array.isArray(data) ? data : [data];
          for (const item of items) {
            const type = item['@type'];
            const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
            if (isProduct) {
              const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
              const price = offers?.price ?? offers?.lowPrice;
              const currency = offers?.priceCurrency;
              return {
                url,
                name: item.name,
                description: item.description
                  ? String(item.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
                  : undefined,
                price: price ? `${price}${currency ? ' ' + currency : ''}` : undefined,
                imageUrl: Array.isArray(item.image) ? item.image[0] : item.image,
                sku: item.sku ?? item.mpn,
              };
            }
          }
        } catch { /* invalid JSON */ }
      }

      // ── 2. Meta / OG tags ─────────────────────────────────────────────────
      const getMeta = (name: string): string | undefined => {
        const patterns = [
          new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
          new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i'),
        ];
        for (const re of patterns) {
          const m = html.match(re);
          if (m?.[1]) return m[1].trim();
        }
        return undefined;
      };

      const name =
        getMeta('og:title') ??
        getMeta('twitter:title') ??
        html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();

      const description =
        getMeta('og:description') ??
        getMeta('description') ??
        getMeta('twitter:description');

      const price =
        getMeta('product:price:amount') ??
        getMeta('og:price:amount') ??
        getMeta('twitter:data1');

      const currency = getMeta('product:price:currency') ?? getMeta('og:price:currency');
      const imageUrl = getMeta('og:image') ?? getMeta('twitter:image');

      if (name) {
        return {
          url,
          name,
          description: description?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          price: price ? `${price}${currency ? ' ' + currency : ''}` : undefined,
          imageUrl,
        };
      }

      return null;
    } catch (err: any) {
      this.logger.warn(`scrapeProductFromUrl failed for ${url}: ${err.message}`);
      return null;
    }
  }

  private async getFallbackProducts() {
    return this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { id: true, name: true, description: true, unitPrice: true, currency: true, stock: true, category: true, sku: true },
    });
  }

  private buildSystemPrompt(
    config: any,
    memory: any,
    prompts: any,
    contact: any,
    products: any[],
    scrapedContext: ScrapedProduct[] = [],
    allProducts: any[] = [],
    attachFullCatalog = true,
  ): string {
    const parts: string[] = [];

    const customPrompt = prompts?.systemPrompt?.trim();
    if (customPrompt) {
      parts.push(customPrompt);
    } else {
      parts.push('Sen bir müşteri hizmetleri ve satış asistanısın. Türkçe yanıt ver.');
    }

    if (memory) {
      const memParts: string[] = [];
      if (memory.sector) memParts.push(`Sektör: ${memory.sector}`);
      if (memory.tone) memParts.push(`İletişim tonu: ${memory.tone}`);
      if (memory.salesStyle) memParts.push(`Satış yaklaşımı: ${memory.salesStyle}`);
      if (memory.pricingBehavior) memParts.push(`Fiyatlandırma: ${memory.pricingBehavior}`);
      if (memory.rawMemory) memParts.push(`\nİşletme özeti: ${memory.rawMemory}`);
      if (memParts.length > 0) parts.push(`\n## İşletme Bilgileri\n${memParts.join('\n')}`);

      // Öğrenilmiş bilgileri ekle (maliyetsiz, DB'den okunuyor)
      if (memory.learnedFaq && Array.isArray(memory.learnedFaq) && memory.learnedFaq.length > 0) {
        const faqLines = (memory.learnedFaq as Array<{ q: string; a: string }>)
          .slice(0, 15)
          .map((f) => `S: ${f.q}\nC: ${f.a}`)
          .join('\n\n');
        parts.push(`\n## Sık Sorulan Sorular\n${faqLines}`);
      }

      if (memory.learnedObjections && Array.isArray(memory.learnedObjections) && memory.learnedObjections.length > 0) {
        const objLines = (memory.learnedObjections as Array<{ objection: string; response: string }>)
          .slice(0, 10)
          .map((o) => `İtiraz: ${o.objection}\nYanıt: ${o.response}`)
          .join('\n\n');
        parts.push(`\n## İtiraz Yanıtları\n${objLines}`);
      }
    }

    if (contact) {
      const name = [contact.name, contact.surname].filter(Boolean).join(' ');
      const contactParts = [`Müşteri adı: ${name || contact.phone}`];
      if (contact.company) contactParts.push(`Firma: ${contact.company}`);
      if (contact.tags?.length) contactParts.push(`Etiketler: ${contact.tags.join(', ')}`);
      if (contact.notes) contactParts.push(`Notlar: ${contact.notes}`);
      parts.push(`\n## Müşteri Bilgileri\n${contactParts.join('\n')}`);
    }

    // ── Tam katalog index (intent/product mesajlarında); selam/sohbette token tasarrufu ──
    if (allProducts.length > 0 && attachFullCatalog) {
      const catalogLines = allProducts.map(
        (p) => `${p.id} | ${p.name} | ${p.unitPrice} ${p.currency}${p.category ? ` | ${p.category}` : ''}`,
      );
      parts.push(
        `\n## Tam Ürün Kataloğu (${allProducts.length} ürün)\n` +
        `KURAL: Müşteri bir ürün sorduğunda YALNIZCA bu katalogdaki ürünleri öner. ` +
        `Katalogda olmayan ürün, boyut veya model için "sistemimizde bu ürün bulunmuyor" de, tahmin yürütme.\n\n` +
        catalogLines.join('\n'),
      );
    } else if (allProducts.length > 0 && !attachFullCatalog) {
      parts.push(
        `\n## Ürün Kataloğu (özet mod)\nBu mesajda tam ürün ID listesi gönderilmedi (${allProducts.length} aktif ürün sistemde kayıtlı). ` +
          `Selamlaşma veya kısa sohbette ürün ID gerektirmez. Müşteri ürün/sipariş/teklif konusunu açınca tam katalog kullanılacaktır. ` +
          `Şimdilik müşteriyle doğal iletişim kur; gerektiği yerde müşteriden ürün adını veya ihtiyacını sor. ` +
          `Bu mesajla ilişkilendirilmiş ürün satırları varsa "Bu Mesajla İlgili Ürünler" bölümünden kullan.`,
      );
    }

    // ── Mesajla ilgili ürünler — detaylı bilgi (açıklama, stok vb.) ──
    if (products.length > 0) {
      const detailLines = products.map((p) => {
        let line = `- ID:${p.id} | ${p.name} | ${p.unitPrice} ${p.currency}`;
        if (p.stock != null) line += ` | Stok:${p.stock}`;
        if (p.sku) line += ` | SKU:${p.sku}`;
        if (p.description) line += `\n  → ${String(p.description).slice(0, 400)}`;
        return line;
      });
      parts.push(`\n## Bu Mesajla İlgili Ürünler (Detaylı)\n${detailLines.join('\n')}`);
    }

    if (prompts?.salesPrompt) parts.push(`\n## Satış Talimatları\n${prompts.salesPrompt}`);
    if (prompts?.supportPrompt) parts.push(`\n## Destek Talimatları\n${prompts.supportPrompt}`);

    // URL'den çekilen ürün bilgileri
    if (scrapedContext.length > 0) {
      for (const sp of scrapedContext) {
        const spParts: string[] = [`\n## Müşterinin Paylaştığı Ürün (${sp.url})`];
        if (sp.name) spParts.push(`Ürün Adı: ${sp.name}`);
        if (sp.sku) spParts.push(`SKU: ${sp.sku}`);
        if (sp.price) spParts.push(`Fiyat (web sitesi): ${sp.price}`);
        if (sp.description) spParts.push(`Açıklama: ${sp.description.slice(0, 600)}`);
        if (sp.imageUrl) spParts.push(`Görsel: ${sp.imageUrl}`);
        if (sp.pastConversations && sp.pastConversations.length > 0) {
          spParts.push(`\nBu ürün hakkında geçmiş konuşmalardan örnekler:`);
          spParts.push(sp.pastConversations.slice(0, 6).join('\n'));
        }
        spParts.push(`\nBu ürün bilgilerini kullanarak müşteriye yardımcı ol. Kendi DB'mizde eşleşen ürün varsa onun ID'sini kullan.`);
        parts.push(spParts.join('\n'));
      }
    }

    parts.push(`
## Sipariş ve Teklif Akışı Kuralları
1. Müşteri sipariş veya teklif istediğinde, önce şunları netleştir (bilmiyorsan sor):
   - Hangi ürün? (CRM listesindeki tam adı)
   - Kaç adet?
   - Varsa özel ölçü/renk/model
2. Tüm bilgiler netteyse create_order veya create_offer fonksiyonunu çağır.
3. Sipariş/teklif oluşturduktan sonra müşteriye özet bilgi ver ve "onaylanması gerekiyor" ise bunu belirt.
4. Tek seferde hem soru sor hem de sipariş oluşturma — önce soruyu sor, cevap gelince siparişi oluştur.
5. Gerekmedikçe sadece text mesaj gönder.`);


    return parts.join('\n');
  }

  private buildTools(policyMap: Record<string, string>): any[] {
    const isAvailable = (action: string) => (policyMap[action] ?? 'OFF') !== 'OFF';
    const tools: any[] = [];

    if (isAvailable('send_message')) {
      tools.push({
        type: 'function',
        function: {
          name: 'send_message',
          description: 'Müşteriye WhatsApp mesajı gönder',
          parameters: {
            type: 'object',
            properties: { text: { type: 'string', description: 'Gönderilecek mesaj metni' } },
            required: ['text'],
          },
        },
      });
    }

    if (isAvailable('ask_question')) {
      tools.push({
        type: 'function',
        function: {
          name: 'ask_question',
          description: 'Müşteriye açıklayıcı soru sor',
          parameters: {
            type: 'object',
            properties: { question: { type: 'string', description: 'Sorulacak soru' } },
            required: ['question'],
          },
        },
      });
    }

    if (isAvailable('suggest_product')) {
      tools.push({
        type: 'function',
        function: {
          name: 'suggest_product',
          description: 'Ürün öner. Ürün kataloğundaki ID\'leri kullan.',
          parameters: {
            type: 'object',
            properties: {
              productIds: { type: 'array', items: { type: 'string' }, description: 'Önerilecek ürün ID listesi' },
              message: { type: 'string', description: 'Ürünlere eşlik edecek mesaj' },
            },
            required: ['productIds'],
          },
        },
      });
    }

    if (isAvailable('create_offer')) {
      tools.push({
        type: 'function',
        function: {
          name: 'create_offer',
          description: 'Müşteri için teklif oluştur',
          parameters: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    qty: { type: 'number' },
                    unitPrice: { type: 'number' },
                    productId: { type: 'string', description: 'Katalogdaki ürün ID (opsiyonel)' },
                  },
                  required: ['name', 'qty', 'unitPrice'],
                },
              },
              note: { type: 'string', description: 'Teklif notu' },
            },
            required: ['items'],
          },
        },
      });
    }

    if (isAvailable('send_offer')) {
      tools.push({
        type: 'function',
        function: {
          name: 'send_offer',
          description: 'Daha önce oluşturulmuş teklifi müşteriye gönder',
          parameters: {
            type: 'object',
            properties: { quoteId: { type: 'string', description: 'Teklif ID\'si' } },
            required: ['quoteId'],
          },
        },
      });
    }

    if (isAvailable('create_order')) {
      tools.push({
        type: 'function',
        function: {
          name: 'create_order',
          description: 'Müşteri için sipariş oluştur',
          parameters: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    qty: { type: 'number' },
                    unitPrice: { type: 'number' },
                    productId: { type: 'string' },
                  },
                  required: ['name', 'qty', 'unitPrice'],
                },
              },
              note: { type: 'string' },
            },
            required: ['items'],
          },
        },
      });
    }

    if (isAvailable('send_payment_link')) {
      tools.push({
        type: 'function',
        function: {
          name: 'send_payment_link',
          description: 'Müşteriye ödeme linki gönder',
          parameters: {
            type: 'object',
            properties: {
              amount: { type: 'number', description: 'Ödeme tutarı (TRY)' },
              description: { type: 'string', description: 'Ödeme açıklaması' },
            },
            required: ['amount'],
          },
        },
      });
    }

    if (isAvailable('update_customer_note')) {
      tools.push({
        type: 'function',
        function: {
          name: 'update_customer_note',
          description: 'Müşteri profilindeki notu güncelle',
          parameters: {
            type: 'object',
            properties: { note: { type: 'string' } },
            required: ['note'],
          },
        },
      });
    }

    if (isAvailable('assign_tag')) {
      tools.push({
        type: 'function',
        function: {
          name: 'assign_tag',
          description: 'Müşteriye etiket ata',
          parameters: {
            type: 'object',
            properties: { tag: { type: 'string', description: 'Etiket adı (ör: VIP, ilgili, iade)' } },
            required: ['tag'],
          },
        },
      });
    }

    if (isAvailable('handoff_to_human')) {
      tools.push({
        type: 'function',
        function: {
          name: 'handoff_to_human',
          description: 'Konuşmayı insan operatöre devret',
          parameters: {
            type: 'object',
            properties: { reason: { type: 'string', description: 'Devir nedeni' } },
            required: ['reason'],
          },
        },
      });
    }

    // send_message is always needed as fallback (even if OFF, we still add it
    // but won't execute — handled in dispatchActionWithToolResult policy gate)
    if (!tools.find((t) => t.function.name === 'send_message')) {
      tools.push({
        type: 'function',
        function: {
          name: 'send_message',
          description: 'Müşteriye mesaj gönder',
          parameters: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      });
    }

    return tools;
  }

  private async queuePendingAction(ctx: AiMessageContext, action: string, payload: any) {
    const payloadStr = JSON.stringify(payload ?? {});
    const duplicate = await this.prisma.aiPendingAction.findFirst({
      where: {
        organizationId: ctx.orgId,
        conversationId: ctx.conversationId,
        action,
        status: 'PENDING',
        createdAt: { gte: new Date(Date.now() - 90_000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, payload: true },
    });
    if (duplicate) {
      const existingStr = JSON.stringify(duplicate.payload ?? {});
      if (existingStr === payloadStr) return;
    }
    await this.prisma.aiPendingAction.create({
      data: {
        organizationId: ctx.orgId,
        contactId: ctx.contactId,
        conversationId: ctx.conversationId,
        action,
        payload,
        status: 'PENDING',
      },
    });
    await this.logAction(ctx.orgId, ctx.contactId, ctx.conversationId, action, 'PENDING', payload);
  }

  private async logAction(
    orgId: string,
    contactId: string,
    conversationId: string,
    action: string,
    status: string,
    payload?: any,
    error?: string,
    durationMs?: number,
    rawInput?: string,
  ) {
    try {
      await this.prisma.aiLog.create({
        data: {
          organizationId: orgId,
          contactId,
          conversationId,
          action,
          status,
          input: rawInput ?? (payload ? JSON.stringify(payload) : null),
          durationMs: durationMs ?? null,
          errorMessage: error ?? null,
        },
      });
    } catch { /* log failure should not crash the engine */ }
  }
}
