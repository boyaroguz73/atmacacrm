import { Injectable, Logger } from '@nestjs/common';

/**
 * Hafif “sub-agent”: gelen metni sınıflandırarak ana modele gönderilecek bağlam boyutunu seçer.
 * Ek maliyet: mesaj başına ~30–50 completion token (gpt-4o-mini).
 */
export type InboundIntent = 'PRODUCT_ORDER' | 'SUPPORT' | 'GREETING_OR_CHITCHAT' | 'OTHER';

@Injectable()
export class AiIntentRouterService {
  private readonly logger = new Logger(AiIntentRouterService.name);

  async classify(
    openaiKey: string,
    model: string,
    userText: string,
  ): Promise<{ intent: InboundIntent; latencyMs: number }> {
    const t0 = Date.now();
    const trimmed = String(userText || '').trim().slice(0, 600);
    if (!trimmed) {
      return { intent: 'OTHER', latencyMs: Date.now() - t0 };
    }

    try {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey: openaiKey });
      const completion = await client.chat.completions.create({
        model: model || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Turkish WhatsApp inbound. Classify into exactly one:
PRODUCT_ORDER — ürün, fiyat, sipariş, teklif, stok, ödeme, kargo
SUPPORT — şikayet, iade, arıza, garanti, teknik
GREETING_OR_CHITCHAT — merhaba, teşekkür, günaydın, tamam, emoji-only, çok kısa nezaket
OTHER — diğer

Yanıt SADECE JSON: {"intent":"PRODUCT_ORDER|SUPPORT|GREETING_OR_CHITCHAT|OTHER"}`,
          },
          { role: 'user', content: trimmed },
        ],
        temperature: 0,
        max_tokens: 60,
      });
      const raw = completion.choices[0]?.message?.content ?? '';
      let intent: InboundIntent = 'OTHER';
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        const j = JSON.parse(m ? m[0] : raw);
        const v = String(j.intent || '').toUpperCase();
        if (v.includes('GREETING') || v.includes('CHITCHAT')) intent = 'GREETING_OR_CHITCHAT';
        else if (v.includes('PRODUCT') || v.includes('ORDER')) intent = 'PRODUCT_ORDER';
        else if (v.includes('SUPPORT')) intent = 'SUPPORT';
        else intent = 'OTHER';
      } catch {
        /* varsayılan OTHER */
      }
      return { intent, latencyMs: Date.now() - t0 };
    } catch (e: any) {
      this.logger.warn(`Intent router failed: ${e?.message}`);
      return { intent: 'OTHER', latencyMs: Date.now() - t0 };
    }
  }

  /** Tam ürün kataloğu sistem promptuna gömülsün mü? */
  shouldAttachFullCatalog(intent: InboundIntent): boolean {
    return intent === 'PRODUCT_ORDER' || intent === 'SUPPORT' || intent === 'OTHER';
  }
}
