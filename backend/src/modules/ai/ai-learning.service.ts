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

      const LEARN_CONV_LIMIT = Math.max(parseInt(process.env.AI_LEARNING_CONV_LIMIT || '500', 10) || 500, 100);
      const LEARN_TURNS_PER_CONV = Math.max(parseInt(process.env.AI_LEARNING_TURNS_PER_CONV || '16', 10) || 16, 8);
      const CHUNK = Math.max(parseInt(process.env.AI_LEARNING_CHUNK_SIZE || '20', 10) || 20, 8);

      // ── 1. Fetch recent conversations ─────────────────────────────────────
      await setProgress(5);
      const conversations = await this.prisma.conversation.findMany({
        where: { session: { organizationId: orgId }, isGroup: false },
        orderBy: { lastMessageAt: 'desc' },
        take: LEARN_CONV_LIMIT,
        select: { id: true, lastMessageAt: true },
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

      // ── 2. Pull messages ──────────────────────────────────────────────────
      const convIds = conversations.map((c) => c.id);
      const allMessages = await this.prisma.message.findMany({
        where: {
          conversationId: { in: convIds },
          body: { not: null },
          mediaType: null, // sadece metin
        },
        orderBy: { timestamp: 'asc' },
        select: { conversationId: true, direction: true, body: true, timestamp: true },
      });

      await setProgress(20);

      // ── 3. Group + clean + dedupe, keep recent turns per conversation ─────
      const convRank = new Map(conversations.map((c, i) => [c.id, i]));
      const byConv: Record<string, Array<{ role: string; text: string; ts: number }>> = {};
      for (const msg of allMessages) {
        if (!byConv[msg.conversationId]) byConv[msg.conversationId] = [];
        const cleaned = this.cleanLearningText(msg.body || '');
        if (!cleaned) continue;
        byConv[msg.conversationId].push({
          role: msg.direction === 'INCOMING' ? 'Müşteri' : 'Operatör',
          text: cleaned,
          ts: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
        });
      }

      // ── 4. Build weighted compact samples ─────────────────────────────────
      const samples: string[] = [];
      for (const [cid, turns] of Object.entries(byConv)) {
        const deduped = this.dedupeTurns(turns);
        const last = deduped.slice(-LEARN_TURNS_PER_CONV);
        if (last.length < 3) continue;
        const rank = convRank.get(cid) ?? 999;
        const recencyWeight = Math.max(1, 8 - Math.floor(rank / 60));
        const compact = [
          `[META] recencyWeight=${recencyWeight}`,
          ...last.map((t) => `[${t.role}]: ${t.text.slice(0, 220)}`),
        ].join('\n');
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

      // ── 6. Process samples in chunks ──────────────────────────────────────
      const chunks: string[][] = [];
      for (let i = 0; i < samples.length; i += CHUNK) {
        chunks.push(samples.slice(i, i + CHUNK));
      }

      const chunkResults: ChunkResult[] = [];
      const progressPerChunk = 40 / Math.max(chunks.length, 1); // 40% → 80%

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

      this.logger.log(
        `Learning complete for org ${orgId}: ${final.faq.length} FAQ, ${final.objections.length} objections, ${final.productKeywords.length} product mappings, samples=${samples.length}, convLimit=${LEARN_CONV_LIMIT}`,
      );
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
  "faq": [{"q": "müşterinin sorusu", "a": "ideal yanıt", "intent": "fiyat|stok|teslimat|iade|ödeme|teknik", "confidence": 0.0}],
  "productKeywords": [{"keyword": "müşterinin kullandığı kelime", "productIds": ["ürün id'leri"], "confidence": 0.0}],
  "objections": [{"objection": "itiraz metni", "response": "başarılı yanıt", "confidence": 0.0}]
}

Kurallar:
- faq: maksimum 20 öğe, en tekrar eden sorular
- productKeywords: müşteri hangi kelimeyle hangi ürünü arıyor, ürün ID'leri aşağıdaki listeden
- objections: maksimum 15 öğe, en sık itirazlar ve çözümleri
- confidence alanı 0..1 arası olsun (emin değilsen düşük ver)
- genel/boş/gürültülü metinleri dahil etme
- Sadece JSON döndür, açıklama ekleme

Ürün listesi (id|ad|kategori):
${productList}

Konuşmalar:
${samples.map((s, i) => `--- Konuşma ${i + 1} ---\n${s}`).join('\n\n')}`;

    try {
      const completion = await Promise.race([
        client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 2000,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('OpenAI chunk timeout (90s)')), 90_000),
        ),
      ]) as any;

      const raw = completion.choices[0]?.message?.content ?? '{}';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

      return {
        faq: Array.isArray(parsed.faq) ? parsed.faq : [],
        productKeywords: Array.isArray(parsed.productKeywords) ? parsed.productKeywords : [],
        objections: Array.isArray(parsed.objections) ? parsed.objections : [],
      };
    } catch (err: any) {
      this.logger.warn(`Chunk analysis failed (skipping): ${err.message}`);
      return { faq: [], productKeywords: [], objections: [] };
    }
  }

  // ─── Merge chunk results ──────────────────────────────────────────────────

  private mergeResults(chunks: ChunkResult[]): ChunkResult {
    const faqMap: Record<string, { q: string; a: string; count: number; conf: number; intent?: string }> = {};
    const kwMap: Record<string, { keyword: string; productIds: Set<string>; count: number; conf: number }> = {};
    const objMap: Record<string, { objection: string; response: string; count: number; conf: number }> = {};

    for (const chunk of chunks) {
      for (const item of chunk.faq) {
        const key = this.normalizeKey(item.q);
        if (!key) continue;
        const c = this.clamp01((item as any).confidence ?? 0.6);
        if (faqMap[key]) {
          faqMap[key].count++;
          faqMap[key].conf += c;
        } else {
          faqMap[key] = { q: item.q, a: item.a, count: 1, conf: c, intent: (item as any).intent };
        }
      }

      for (const item of chunk.productKeywords) {
        const key = this.normalizeKey(item.keyword);
        if (!key) continue;
        const c = this.clamp01((item as any).confidence ?? 0.6);
        if (kwMap[key]) {
          for (const id of (item.productIds ?? [])) kwMap[key].productIds.add(id);
          kwMap[key].count++;
          kwMap[key].conf += c;
        } else {
          kwMap[key] = { keyword: item.keyword, productIds: new Set(item.productIds ?? []), count: 1, conf: c };
        }
      }

      for (const item of chunk.objections) {
        const key = this.normalizeKey(item.objection);
        if (!key) continue;
        const c = this.clamp01((item as any).confidence ?? 0.6);
        if (objMap[key]) {
          objMap[key].count++;
          objMap[key].conf += c;
        } else {
          objMap[key] = { objection: item.objection, response: item.response, count: 1, conf: c };
        }
      }
    }

    return {
      faq: Object.values(faqMap)
        .sort((a, b) => (b.count + b.conf) - (a.count + a.conf))
        .slice(0, 50)
        .map(({ q, a, intent, conf, count }) => ({ q, a, intent, confidence: this.clamp01(conf / Math.max(count, 1)) })),

      productKeywords: Object.values(kwMap)
        .sort((a, b) => (b.count + b.conf) - (a.count + a.conf))
        .slice(0, 100)
        .map(({ keyword, productIds, conf, count }) => ({ keyword, productIds: [...productIds], confidence: this.clamp01(conf / Math.max(count, 1)) })),

      objections: Object.values(objMap)
        .sort((a, b) => (b.count + b.conf) - (a.count + a.conf))
        .slice(0, 30)
        .map(({ objection, response, conf, count }) => ({ objection, response, confidence: this.clamp01(conf / Math.max(count, 1)) })),
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
      const completion = await Promise.race([
        client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 3000,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('consolidate timeout (120s)')), 120_000),
        ),
      ]) as any;

      const raw = completion.choices[0]?.message?.content ?? '{}';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

      const faq = (Array.isArray(parsed.faq) ? parsed.faq : merged.faq)
        .filter((x: any) => x?.q && x?.a)
        .slice(0, 20);
      const productKeywords = (Array.isArray(parsed.productKeywords) ? parsed.productKeywords : merged.productKeywords)
        .filter((x: any) => x?.keyword && Array.isArray(x?.productIds) && x.productIds.length > 0)
        .slice(0, 50);
      const objections = (Array.isArray(parsed.objections) ? parsed.objections : merged.objections)
        .filter((x: any) => x?.objection && x?.response)
        .slice(0, 15);
      return { faq, productKeywords, objections };
    } catch {
      return {
        faq: merged.faq.slice(0, 20),
        productKeywords: merged.productKeywords.slice(0, 50),
        objections: merged.objections.slice(0, 15),
      };
    }
  }

  private cleanLearningText(input: string): string {
    const txt = String(input || '')
      .replace(/\s+/g, ' ')
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, ' ')
      .trim();
    if (!txt || txt.length < 6) return '';
    if (/^[A-Za-z0-9+/=\s]{120,}$/.test(txt)) return ''; // encoded/noisy
    return txt;
  }

  private dedupeTurns(turns: Array<{ role: string; text: string; ts: number }>) {
    const out: Array<{ role: string; text: string; ts: number }> = [];
    let prev = '';
    for (const t of turns) {
      const key = `${t.role}:${this.normalizeKey(t.text)}`;
      if (!key || key === prev) continue;
      prev = key;
      out.push(t);
    }
    return out;
  }

  private normalizeKey(v: unknown): string {
    return String(v || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90);
  }

  private clamp01(n: unknown): number {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }
}

interface ChunkResult {
  faq: Array<{ q: string; a: string; intent?: string; confidence?: number }>;
  productKeywords: Array<{ keyword: string; productIds: string[]; confidence?: number }>;
  objections: Array<{ objection: string; response: string; confidence?: number }>;
}
