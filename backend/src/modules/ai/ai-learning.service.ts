import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AiLearningService
 *
 * Son 500 konuşmayı GPT-4o-mini ile toplu analiz eder.
 * Sonuçlar AiBusinessMemory tablosuna yazılır:
 *   - learnedFaq:        Sık sorulan sorular + cevaplar
 *   - learnedProducts:   Hangi anahtar kelime hangi ürün grubuna yönlendiriyor
 *   - learnedObjections: Yaygın itirazlar + başarılı yanıtlar
 *
 * Bu veriler AiEngineService tarafından her mesajın bağlamına eklenir;
 * böylece tüm ürün kataloğu yerine sadece öğrenilmiş eşleştirmeler iletilir.
 */
@Injectable()
export class AiLearningService {
  private readonly logger = new Logger(AiLearningService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  async startLearning(orgId: string): Promise<{ started: boolean }> {
    const config = await this.prisma.aiConfig.findUnique({ where: { organizationId: orgId } });
    if (!config?.openaiKey) throw new BadRequestException('OpenAI API anahtarı girilmemiş');

    await this.prisma.aiBusinessMemory.upsert({
      where: { organizationId: orgId },
      update: { learningStatus: 'running', learningProgress: 0, learningError: null },
      create: { organizationId: orgId, learningStatus: 'running', learningProgress: 0 },
    });

    this.runLearningBackground(orgId, config.openaiKey).catch((err) => {
      this.logger.error(`Learning failed for org ${orgId}: ${err.message}`);
    });

    return { started: true };
  }

  async getLearningStatus(orgId: string) {
    const mem = await this.prisma.aiBusinessMemory.findUnique({ where: { organizationId: orgId } });
    return {
      status: mem?.learningStatus ?? 'idle',
      progress: mem?.learningProgress ?? 0,
      error: mem?.learningError ?? null,
      learnedAt: mem?.learnedAt ?? null,
    };
  }

  // ─── Background job ───────────────────────────────────────────────────────

  private async runLearningBackground(orgId: string, openaiKey: string) {
    const setProgress = (p: number) =>
      this.prisma.aiBusinessMemory.update({
        where: { organizationId: orgId },
        data: { learningProgress: p },
      });

    try {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey: openaiKey });

      // ── 1. Fetch 500 conversations ────────────────────────────────────────
      await setProgress(5);
      const conversations = await this.prisma.conversation.findMany({
        where: { session: { organizationId: orgId }, isGroup: false },
        orderBy: { lastMessageAt: 'desc' },
        take: 500,
        select: { id: true },
      });

      if (conversations.length === 0) {
        await this.prisma.aiBusinessMemory.update({
          where: { organizationId: orgId },
          data: {
            learningStatus: 'done',
            learningProgress: 100,
            learnedAt: new Date(),
            learningError: null,
          },
        });
        return;
      }

      await setProgress(10);

      // ── 2. Pull messages for each conversation (last 30 per conv) ─────────
      const convIds = conversations.map((c) => c.id);
      const allMessages = await this.prisma.message.findMany({
        where: {
          conversationId: { in: convIds },
          body: { not: null },
          mediaType: null, // sadece metin
        },
        orderBy: { timestamp: 'asc' },
        select: { conversationId: true, direction: true, body: true },
      });

      await setProgress(20);

      // ── 3. Group by conversation, keep last 30 per conv ───────────────────
      const byConv: Record<string, Array<{ role: string; text: string }>> = {};
      for (const msg of allMessages) {
        if (!byConv[msg.conversationId]) byConv[msg.conversationId] = [];
        byConv[msg.conversationId].push({
          role: msg.direction === 'INCOMING' ? 'Müşteri' : 'Operatör',
          text: msg.body!,
        });
      }

      // ── 4. Build compact text samples ─────────────────────────────────────
      // Each conversation → max 20 exchanges → compact line format
      const samples: string[] = [];
      for (const [, turns] of Object.entries(byConv)) {
        const last = turns.slice(-20);
        const compact = last.map((t) => `[${t.role}]: ${t.text.slice(0, 200)}`).join('\n');
        samples.push(compact);
      }

      await setProgress(30);

      // ── 5. Fetch product catalog for matching ─────────────────────────────
      const products = await this.prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, name: true, category: true },
        orderBy: { name: 'asc' },
      });

      await setProgress(40);

      // ── 6. Process in chunks of 50 conversations each ─────────────────────
      const CHUNK = 50;
      const chunks: string[][] = [];
      for (let i = 0; i < samples.length; i += CHUNK) {
        chunks.push(samples.slice(i, i + CHUNK));
      }

      const chunkResults: ChunkResult[] = [];
      const progressPerChunk = 40 / chunks.length; // 40% → 80%

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const result = await this.analyzeChunk(client, chunk, products);
        chunkResults.push(result);
        await setProgress(Math.round(40 + (i + 1) * progressPerChunk));
      }

      await setProgress(85);

      // ── 7. Merge all chunk results ─────────────────────────────────────────
      const merged = this.mergeResults(chunkResults);

      await setProgress(92);

      // ── 8. Final consolidation pass with GPT ──────────────────────────────
      const final = await this.consolidateResults(client, merged, products);

      // ── 9. Save ────────────────────────────────────────────────────────────
      await this.prisma.aiBusinessMemory.update({
        where: { organizationId: orgId },
        data: {
          learningStatus: 'done',
          learningProgress: 100,
          learnedAt: new Date(),
          learningError: null,
          learnedFaq: final.faq,
          learnedProducts: final.productKeywords,
          learnedObjections: final.objections,
        },
      });

      this.logger.log(`Learning complete for org ${orgId}: ${final.faq.length} FAQ, ${final.objections.length} objections, ${final.productKeywords.length} product mappings`);
    } catch (err: any) {
      await this.prisma.aiBusinessMemory.update({
        where: { organizationId: orgId },
        data: {
          learningStatus: 'failed',
          learningProgress: 0,
          learningError: err?.message ?? 'Bilinmeyen hata',
        },
      });
      throw err;
    }
  }

  // ─── Chunk analysis ───────────────────────────────────────────────────────

  private async analyzeChunk(
    client: any,
    samples: string[],
    products: Array<{ id: string; name: string; category: string | null }>,
  ): Promise<ChunkResult> {
    const productList = products
      .slice(0, 200) // chunk için özet liste
      .map((p) => `${p.id}|${p.name}${p.category ? `|${p.category}` : ''}`)
      .join('\n');

    const prompt = `Sana ${samples.length} adet müşteri-operatör WhatsApp konuşması verilecek.
Bu konuşmaları analiz et ve şu JSON yapısını döndür:

{
  "faq": [{"q": "müşterinin sorusu", "a": "ideal yanıt"}],
  "productKeywords": [{"keyword": "müşterinin kullandığı kelime", "productIds": ["ürün id'leri"]}],
  "objections": [{"objection": "itiraz metni", "response": "başarılı yanıt"}]
}

Kurallar:
- faq: maksimum 20 öğe, en tekrar eden sorular
- productKeywords: müşteri hangi kelimeyle hangi ürünü arıyor, ürün ID'leri aşağıdaki listeden
- objections: maksimum 15 öğe, en sık itirazlar ve çözümleri
- Sadece JSON döndür, açıklama ekleme

Ürün listesi (id|ad|kategori):
${productList}

Konuşmalar:
${samples.map((s, i) => `--- Konuşma ${i + 1} ---\n${s}`).join('\n\n')}`;

    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 2000,
      });

      const raw = completion.choices[0]?.message?.content ?? '{}';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

      return {
        faq: Array.isArray(parsed.faq) ? parsed.faq : [],
        productKeywords: Array.isArray(parsed.productKeywords) ? parsed.productKeywords : [],
        objections: Array.isArray(parsed.objections) ? parsed.objections : [],
      };
    } catch (err: any) {
      this.logger.warn(`Chunk analysis failed: ${err.message}`);
      return { faq: [], productKeywords: [], objections: [] };
    }
  }

  // ─── Merge chunk results ──────────────────────────────────────────────────

  private mergeResults(chunks: ChunkResult[]): ChunkResult {
    const faqMap: Record<string, { q: string; a: string; count: number }> = {};
    const kwMap: Record<string, { keyword: string; productIds: Set<string>; count: number }> = {};
    const objMap: Record<string, { objection: string; response: string; count: number }> = {};

    for (const chunk of chunks) {
      for (const item of chunk.faq) {
        const key = item.q?.toLowerCase().slice(0, 60) ?? '';
        if (!key) continue;
        if (faqMap[key]) { faqMap[key].count++; }
        else { faqMap[key] = { q: item.q, a: item.a, count: 1 }; }
      }

      for (const item of chunk.productKeywords) {
        const key = item.keyword?.toLowerCase() ?? '';
        if (!key) continue;
        if (kwMap[key]) {
          for (const id of (item.productIds ?? [])) kwMap[key].productIds.add(id);
          kwMap[key].count++;
        } else {
          kwMap[key] = { keyword: item.keyword, productIds: new Set(item.productIds ?? []), count: 1 };
        }
      }

      for (const item of chunk.objections) {
        const key = item.objection?.toLowerCase().slice(0, 60) ?? '';
        if (!key) continue;
        if (objMap[key]) { objMap[key].count++; }
        else { objMap[key] = { objection: item.objection, response: item.response, count: 1 }; }
      }
    }

    return {
      faq: Object.values(faqMap)
        .sort((a, b) => b.count - a.count)
        .slice(0, 50)
        .map(({ q, a }) => ({ q, a })),

      productKeywords: Object.values(kwMap)
        .sort((a, b) => b.count - a.count)
        .slice(0, 100)
        .map(({ keyword, productIds }) => ({ keyword, productIds: [...productIds] })),

      objections: Object.values(objMap)
        .sort((a, b) => b.count - a.count)
        .slice(0, 30)
        .map(({ objection, response }) => ({ objection, response })),
    };
  }

  // ─── Final consolidation ──────────────────────────────────────────────────

  private async consolidateResults(
    client: any,
    merged: ChunkResult,
    products: Array<{ id: string; name: string }>,
  ): Promise<ChunkResult> {
    if (merged.faq.length <= 20 && merged.objections.length <= 15 && merged.productKeywords.length <= 50) {
      return merged; // already compact, skip extra API call
    }

    const prompt = `Aşağıdaki ham öğrenme verilerini kısalt ve sadeleştir.
Sonuç olarak şu JSON yapısını döndür:

{
  "faq": [{"q": "...", "a": "..."}],
  "productKeywords": [{"keyword": "...", "productIds": ["..."]}],
  "objections": [{"objection": "...", "response": "..."}]
}

Kısıtlar: faq maks 20, productKeywords maks 50, objections maks 15.
Benzer olanları birleştir, en önemli olanları tut. Sadece JSON döndür.

Ham veri:
${JSON.stringify(merged, null, 1).slice(0, 8000)}`;

    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 3000,
      });

      const raw = completion.choices[0]?.message?.content ?? '{}';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

      return {
        faq: Array.isArray(parsed.faq) ? parsed.faq.slice(0, 20) : merged.faq.slice(0, 20),
        productKeywords: Array.isArray(parsed.productKeywords) ? parsed.productKeywords.slice(0, 50) : merged.productKeywords.slice(0, 50),
        objections: Array.isArray(parsed.objections) ? parsed.objections.slice(0, 15) : merged.objections.slice(0, 15),
      };
    } catch {
      return {
        faq: merged.faq.slice(0, 20),
        productKeywords: merged.productKeywords.slice(0, 50),
        objections: merged.objections.slice(0, 15),
      };
    }
  }
}

interface ChunkResult {
  faq: Array<{ q: string; a: string }>;
  productKeywords: Array<{ keyword: string; productIds: string[] }>;
  objections: Array<{ objection: string; response: string }>;
}
