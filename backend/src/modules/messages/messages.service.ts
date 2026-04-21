import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WahaService } from '../waha/waha.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ChatGateway } from '../websocket/chat.gateway';
import { ConfigService } from '@nestjs/config';
import { MessageDirection, MessageStatus } from '@prisma/client';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import axios from 'axios';
import { v4 as uuid } from 'uuid';
import { lookup } from 'mime-types';
import { normalizeWhatsappChatId } from '../../common/whatsapp-chat-id';
import { optimizeImageBufferForWhatsapp } from '../../common/whatsapp-image';
import { ProductsService } from '../products/products.service';

@Injectable()
export class MessagesService implements OnModuleInit {
  private readonly logger = new Logger(MessagesService.name);
  private readonly mediaBackfillDir = join(process.cwd(), 'uploads', 'media-backfill');

  constructor(
    private prisma: PrismaService,
    private wahaService: WahaService,
    private conversationsService: ConversationsService,
    private chatGateway: ChatGateway,
    private config: ConfigService,
    private productsService: ProductsService,
  ) {}

  onModuleInit() {
    // Backend restart sonrası son medya kayıtlarını tekrar dene (özellikle docker up -d backend).
    setTimeout(() => {
      this.backfillRecentMediaOnStartup(30).catch((err) => {
        this.logger.warn(`Startup media backfill atlandı: ${err?.message || err}`);
      });
    }, 12_000);
  }

  private extractWaMessageId(waResponse: any): string | null {
    if (!waResponse) return null;
    if (typeof waResponse.id === 'string') return waResponse.id;
    if (waResponse.id?._serialized) return waResponse.id._serialized;
    if (waResponse.id?.id) return waResponse.id.id;
    if (waResponse.key?.id) return waResponse.key.id;
    return null;
  }

  /**
   * Mesajı veritabanına kaydet. waMessageId varsa upsert (webhook yarışını önler),
   * yoksa waMessageId'siz create.
   */
  private async persistMessage(
    data: {
      conversationId: string;
      sessionId: string;
      waMessageId: string | null;
      direction: MessageDirection;
      body: string;
      status: MessageStatus;
      sentById?: string;
      mediaUrl?: string;
      mediaType?: any;
      mediaMimeType?: string;
      metadata?: any;
    },
  ) {
    const { waMessageId, ...rest } = data;

    if (waMessageId) {
      // Yerel olarak yüklenmiş (/uploads/...) medyayı koru: webhook, aynı mesajı
      // WhatsApp'ın yeniden-sıkıştırdığı düşük kaliteli URL ile yazmış olabilir; bu yarışı
      // gidermek için gönderimde elimizdeki orijinal URL'i üzerine yazıyoruz.
      const isLocalUpload =
        typeof rest.mediaUrl === 'string' && rest.mediaUrl.includes('/uploads/');
      return this.prisma.message.upsert({
        where: { waMessageId },
        create: { ...rest, waMessageId },
        update: {
          sentById: rest.sentById || undefined,
          ...(isLocalUpload ? { mediaUrl: rest.mediaUrl } : {}),
          ...(isLocalUpload && rest.mediaType ? { mediaType: rest.mediaType } : {}),
          ...(isLocalUpload && rest.mediaMimeType ? { mediaMimeType: rest.mediaMimeType } : {}),
          ...(rest.metadata ? { metadata: rest.metadata } : {}),
        },
        include: { sentBy: { select: { id: true, name: true } } },
      });
    }

    return this.prisma.message.create({
      data: rest,
      include: { sentBy: { select: { id: true, name: true } } },
    });
  }

  private emitAndUpdateList(conversationId: string, message: any, previewText: string) {
    this.conversationsService
      .updateLastMessage(conversationId, previewText)
      .then(() => this.conversationsService.findById(conversationId))
      .then((fullConv) =>
        this.chatGateway.emitNewMessage(conversationId, {
          message,
          conversation: fullConv,
        }),
      )
      .catch((err) =>
        this.logger.error(`Socket/liste güncelleme hatası: ${err?.message}`),
      );
  }

  async getByConversation(
    conversationId: string,
    params: { cursor?: string; limit?: number },
  ) {
    const { cursor, limit = 50 } = params;

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'desc' },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        sentBy: { select: { id: true, name: true } },
        session: { select: { name: true } },
      },
    });

    if (messages.length > 0) {
      await this.backfillConversationMedia(messages);
    }

    return {
      messages: messages.reverse(),
      nextCursor: messages.length === limit ? messages[0]?.id : null,
    };
  }

  /** WAHA /api/files URL veya boş mediaUrl için yerel dosyaya indir (ses/video vb.). */
  private extFromDownloaded(downloaded: { filename?: string; mimetype?: string }, fileId: string): string {
    const fromName = extname(downloaded.filename || '') || extname(fileId);
    if (fromName) return fromName;
    const mt = (downloaded.mimetype || '').split(';')[0].trim();
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'audio/ogg': '.ogg',
      'audio/opus': '.ogg',
      'audio/mpeg': '.mp3',
      'audio/mp4': '.m4a',
      'application/pdf': '.pdf',
    };
    return map[mt] || (downloaded.mimetype?.startsWith('audio/') ? '.ogg' : '.bin');
  }

  private collectFileCandidates(message: any): { sessionName: string; fileIds: string[] } {
    const mediaUrl = String(message?.mediaUrl || '').trim();
    const fromMeta =
      message?.metadata && typeof message.metadata === 'object'
        ? (message.metadata as Record<string, unknown>)
        : {};
    const originalMediaUrl = String(fromMeta.originalMediaUrl || '').trim();

    const parseApiFiles = (url: string): { session?: string; fileId?: string } => {
      const m = url.match(/\/api\/files\/([^/]+)\/([^/?#]+)/i);
      return {
        session: m?.[1] ? decodeURIComponent(m[1]) : undefined,
        fileId: m?.[2] ? decodeURIComponent(m[2]) : undefined,
      };
    };

    const p1 = parseApiFiles(mediaUrl);
    const p2 = parseApiFiles(originalMediaUrl);
    const sessionName =
      (p1.session || p2.session || String(message?.session?.name || '')).trim();

    const rawCandidates = [
      p1.fileId,
      p2.fileId,
      String(message?.waMessageId || ''),
      typeof fromMeta.fileId === 'string' ? fromMeta.fileId : '',
    ]
      .map((x) => String(x || '').trim())
      .filter((x) => x.length > 0);

    return { sessionName, fileIds: [...new Set(rawCandidates)] };
  }

  private isBackfillExhausted(meta: Record<string, any> | undefined): boolean {
    if (!meta) return false;
    return meta.backfillFailed === true;
  }

  private async backfillConversationMedia(messages: any[]) {
    const backfillable = new Set(['AUDIO', 'VIDEO', 'IMAGE', 'DOCUMENT']);
    const pool: any[] = [];
    const seen = new Set<string>();

    for (const m of messages) {
      if (!m?.waMessageId || !m.mediaType || !backfillable.has(String(m.mediaType))) continue;
      const meta = m.metadata && typeof m.metadata === 'object'
        ? (m.metadata as Record<string, any>)
        : undefined;
      if (this.isBackfillExhausted(meta)) continue;

      const sessionName = m.session?.name ? String(m.session.name) : '';
      const mediaUrl = String(m.mediaUrl || '').trim();

      const fromApiFiles =
        mediaUrl.includes('/api/files/') && !mediaUrl.includes('/uploads/');
      const missingLocal =
        !mediaUrl ||
        (!mediaUrl.includes('/uploads/') && !mediaUrl.startsWith('http'));

      if (fromApiFiles || (missingLocal && sessionName)) {
        const key = m.id;
        if (!seen.has(key)) {
          seen.add(key);
          pool.push(m);
        }
      }
    }

    const candidates = pool.slice(0, 14);
    if (candidates.length === 0) return;

    mkdirSync(this.mediaBackfillDir, { recursive: true });

    for (const m of candidates) {
      try {
        const { sessionName, fileIds } = this.collectFileCandidates(m);
        if (!sessionName || fileIds.length === 0) continue;

        let hit:
          | { downloaded: { data: Buffer; mimetype: string; filename: string }; fileId: string }
          | null = null;
        for (const fileId of fileIds) {
          const downloaded = await this.wahaService.downloadFile(sessionName, fileId);
          if (downloaded?.data?.length) {
            hit = { downloaded, fileId };
            break;
          }
        }
        if (!hit) {
          const prevMeta =
            m.metadata && typeof m.metadata === 'object' ? (m.metadata as Record<string, any>) : {};
          await this.prisma.message.update({
            where: { id: m.id },
            data: {
              metadata: {
                ...prevMeta,
                backfillFailed: true,
                backfillFailedAt: new Date().toISOString(),
                fileIdTried: fileIds,
              } as any,
            },
          });
          continue;
        }

        const inferredExt = this.extFromDownloaded(hit.downloaded, hit.fileId);
        const localName = `${uuid()}${inferredExt}`;
        const fullPath = join(this.mediaBackfillDir, localName);
        writeFileSync(fullPath, hit.downloaded.data);

        const newMediaUrl = `/uploads/media-backfill/${localName}`;
        const prevMeta =
          m.metadata && typeof m.metadata === 'object' ? (m.metadata as Record<string, any>) : {};
        const nextMeta = {
          ...prevMeta,
          source: 'media_backfill',
          backfillFailed: false,
          originalMediaUrl: String(m.mediaUrl || '') || prevMeta.originalMediaUrl || null,
          originalMimeType:
            hit.downloaded.mimetype || m.mediaMimeType || prevMeta.originalMimeType || null,
          backfilledAt: new Date().toISOString(),
          fileIdTried: fileIds,
          fileIdResolved: hit.fileId,
        };

        await this.prisma.message.update({
          where: { id: m.id },
          data: {
            mediaUrl: newMediaUrl,
            mediaMimeType: hit.downloaded.mimetype || m.mediaMimeType || undefined,
            metadata: nextMeta as any,
          },
        });
        m.mediaUrl = newMediaUrl;
        m.mediaMimeType = hit.downloaded.mimetype || m.mediaMimeType;
        m.metadata = nextMeta;
      } catch (err: any) {
        this.logger.debug(`Medya backfill atlandı (${m?.id}): ${err?.message}`);
      }
    }
  }

  async backfillRecentMediaOnStartup(limit = 30) {
    const recent = await this.prisma.message.findMany({
      where: {
        mediaType: { in: ['IMAGE', 'VIDEO', 'AUDIO'] as any },
      },
      orderBy: { timestamp: 'desc' },
      take: Math.max(1, Math.min(limit, 120)),
      include: {
        session: { select: { name: true } },
      },
    });
    if (!recent.length) return;
    this.logger.log(`Startup media backfill: ${recent.length} kayıt kontrol ediliyor`);
    await this.backfillConversationMedia(recent);
  }

  async sendText(params: {
    conversationId: string;
    sessionName: string;
    chatId: string;
    body: string;
    sentById: string;
  }) {
    const { conversationId, sessionName, chatId, body, sentById } = params;
    const jid = normalizeWhatsappChatId(chatId);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Görüşme bulunamadı');

    const waResponse = await this.callWahaSendText(sessionName, jid, body);
    const waMessageId = this.extractWaMessageId(waResponse);

    const message = await this.persistMessage({
      conversationId,
      sessionId: conversation.sessionId,
      waMessageId,
      direction: MessageDirection.OUTGOING,
      body,
      status: MessageStatus.SENT,
      sentById,
    });

    this.emitAndUpdateList(conversationId, message, body);
    return message;
  }

  private async callWahaSendText(session: string, chatId: string, text: string) {
    try {
      return await this.wahaService.sendText(session, chatId, text);
    } catch (err: any) {
      const d = err.response?.data;
      const msg =
        (typeof d?.message === 'string' && d.message) ||
        (typeof d?.error === 'string' && d.error) ||
        (typeof d === 'string' && d) ||
        (Array.isArray(d?.message) ? d.message.join(', ') : null) ||
        err.message ||
        'WhatsApp üzerinden mesaj gönderilemedi.';
      this.logger.warn(`WAHA sendText hata: ${msg}`);
      throw new BadRequestException(msg);
    }
  }

  private detectMediaType(mimetype: string): { mediaType: string; preview: string } {
    if (mimetype.startsWith('image/')) return { mediaType: 'IMAGE', preview: '📷 Görsel' };
    if (mimetype.startsWith('video/')) return { mediaType: 'VIDEO', preview: '🎬 Video' };
    if (mimetype.startsWith('audio/')) return { mediaType: 'AUDIO', preview: '🎵 Ses' };
    return { mediaType: 'DOCUMENT', preview: '📄 Dosya' };
  }

  async sendMedia(params: {
    conversationId: string;
    sessionName: string;
    chatId: string;
    mediaUrl: string;
    caption?: string;
    sentById: string;
  }) {
    const { conversationId, sessionName, chatId, mediaUrl, caption, sentById } = params;
    const jid = normalizeWhatsappChatId(chatId);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Görüşme bulunamadı');

    const localPath = this.resolveLocalPath(mediaUrl);
    if (!localPath || !existsSync(localPath)) {
      throw new BadRequestException('Medya dosyası sunucuda bulunamadı');
    }

    const fileBuffer = readFileSync(localPath);
    const ext = extname(localPath);
    const mimetype = (lookup(ext) as string) || 'application/octet-stream';
    const originalFilename = localPath.split(/[\\/]/).pop() || `file${ext}`;
    const { mediaType, preview } = this.detectMediaType(mimetype);

    let waResponse: any;
    let outboundMimeType = mimetype;
    try {
      if (mediaType === 'IMAGE') {
        // Kaliteyi koru: limitler içindeyse orijinal passthrough; aşımda yüksek kaliteli JPEG.
        // width/height WAHA'ya geçilir; WhatsApp'ın gereksiz yeniden ölçeklemesi/kırpması azalır.
        const opt = await optimizeImageBufferForWhatsapp(fileBuffer);
        outboundMimeType = opt.mimetype;
        waResponse = await this.wahaService.sendImage(
          sessionName,
          jid,
          {
            mimetype: opt.mimetype,
            data: opt.base64,
            filename: opt.filename,
            width: opt.width,
            height: opt.height,
          },
          caption,
        );
      } else {
        const base64Data = fileBuffer.toString('base64');
        waResponse = await this.wahaService.sendFile(
          sessionName,
          jid,
          { mimetype, data: base64Data, filename: originalFilename },
          caption,
        );
      }
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || '';
      if (errMsg.includes('Plus version'))
        throw new BadRequestException('Bu dosya tipi WAHA ücretsiz sürümde desteklenmiyor.');
      throw new BadRequestException(errMsg || 'Medya gönderilemedi');
    }

    const waMessageId = this.extractWaMessageId(waResponse);

    const message = await this.persistMessage({
      conversationId,
      sessionId: conversation.sessionId,
      waMessageId,
      direction: MessageDirection.OUTGOING,
      body: caption || '',
      status: MessageStatus.SENT,
      sentById,
      mediaUrl,
      mediaType: mediaType as any,
      mediaMimeType: outboundMimeType,
    });

    this.emitAndUpdateList(conversationId, message, caption || preview);
    return message;
  }

  /** Ürün (veya belirli varyantın) ana görselini indirip WhatsApp'ta gönderir (sohbet ürün paylaşımı) */
  async sendProductShare(params: {
    conversationId: string;
    productId: string;
    productVariantId?: string;
    sentById: string;
    sessionName?: string;
    chatId?: string;
  }) {
    const { conversationId, productId, productVariantId, sentById } = params;
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { session: true, contact: true },
    });
    if (!conv) throw new NotFoundException('Görüşme bulunamadı');
    const sessionName = (params.sessionName || '').trim() || conv.session.name;
    const chatId =
      (params.chatId || '').trim() ||
      normalizeWhatsappChatId(`${conv.contact.phone.replace(/\D/g, '')}@c.us`);
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Ürün bulunamadı');

    const variant = productVariantId
      ? await this.prisma.productVariant.findFirst({
          where: { id: productVariantId, productId },
        })
      : null;
    if (productVariantId && !variant) {
      throw new NotFoundException('Varyant bulunamadı');
    }

    const effName = variant
      ? (variant.name.includes(product.name) ? variant.name : `${product.name} — ${variant.name}`)
      : product.name;
    const unitPrice = Number(variant?.unitPrice ?? product.unitPrice ?? 0);
    const currency = variant?.currency || product.currency;
    const priceIncludesVat = variant?.priceIncludesVat ?? product.priceIncludesVat;
    const priceStr = `${unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${currency}`;
    // Entegrasyon (T-Soft vb.) fiyatları genelde KDV hariç; mesajda +KDV ile göster
    const priceLine = priceIncludesVat
      ? `Fiyat (KDV Dahil): ${priceStr}`
      : `Fiyat: ${priceStr} +KDV`;
    const siteLink = (product.productUrl || '').trim();
    const caption = [
      effName,
      priceLine,
      siteLink ? `Ürün linki: ${siteLink}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const localUrl = variant
      ? await this.productsService.ensureVariantImageLocal(variant.id)
      : await this.productsService.ensureProductImageLocal(productId);

    if (localUrl) {
      const mediaUrl = localUrl.startsWith('/') ? localUrl : `/${localUrl}`;
      try {
        return await this.sendMedia({
          conversationId,
          sessionName,
          chatId,
          mediaUrl,
          caption,
          sentById,
        });
      } catch (e: any) {
        this.logger.warn(`Ürün görseli gönderilemedi: ${e?.message}`);
        return this.sendText({ conversationId, sessionName, chatId, body: caption, sentById });
      }
    }

    this.logger.debug(
      `Ürün görseli yok veya indirilemedi, metin gönderiliyor: productId=${productId} variantId=${productVariantId ?? '-'}`,
    );
    return this.sendText({
      conversationId,
      sessionName,
      chatId,
      body: caption,
      sentById,
    });
  }

  private resolveLocalPath(mediaUrl: string): string | null {
    if (mediaUrl.includes('/uploads/')) {
      const filename = mediaUrl.split('/uploads/').pop();
      if (filename) return join(process.cwd(), 'uploads', filename);
    }
    return null;
  }

  async storeIncoming(params: {
    conversationId: string;
    sessionId: string;
    waMessageId: string;
    body?: string;
    mediaUrl?: string;
    mediaType?: string;
    mediaMimeType?: string;
    timestamp: Date;
  }) {
    return this.prisma.message.create({
      data: {
        conversationId: params.conversationId,
        sessionId: params.sessionId,
        waMessageId: params.waMessageId,
        direction: MessageDirection.INCOMING,
        body: params.body,
        mediaUrl: params.mediaUrl,
        mediaType: params.mediaType as any,
        mediaMimeType: params.mediaMimeType,
        status: MessageStatus.DELIVERED,
        timestamp: params.timestamp,
      },
      include: { sentBy: { select: { id: true, name: true } } },
    });
  }

  async editMessage(params: {
    messageId: string;
    sessionName: string;
    chatId: string;
    newBody: string;
    userId: string;
  }) {
    const { messageId, sessionName, chatId, newBody, userId } = params;
    const jid = normalizeWhatsappChatId(chatId);

    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Mesaj bulunamadı');
    if (message.direction !== 'OUTGOING') throw new BadRequestException('Sadece giden mesajlar düzenlenebilir');
    if (!message.waMessageId) throw new BadRequestException('WAHA mesaj ID bulunamadı');

    try {
      await this.wahaService.editMessage(sessionName, jid, message.waMessageId, newBody);
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || '';
      if (errMsg.includes('Plus version') || errMsg.includes('not support'))
        throw new BadRequestException('Mesaj düzenleme WAHA Plus gerektirir.');
      throw new BadRequestException(errMsg || 'Mesaj düzenlenemedi');
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { body: newBody, isEdited: true, editedAt: new Date() },
      include: { sentBy: { select: { id: true, name: true } } },
    });

    this.chatGateway.server
      .to(`conversation:${message.conversationId}`)
      .emit('message:edited', {
        messageId: updated.id,
        body: updated.body,
        isEdited: true,
        editedAt: updated.editedAt,
      });

    return updated;
  }

  async updateStatus(waMessageId: string, status: MessageStatus) {
    return this.prisma.message.updateMany({
      where: { waMessageId },
      data: { status },
    });
  }

  /** WAHA Plus - Mesaja yanıt gönder */
  async sendReply(params: {
    conversationId: string;
    sessionName: string;
    chatId: string;
    body: string;
    quotedMessageId: string;
    sentById?: string;
  }) {
    const { conversationId, sessionName, chatId, body, quotedMessageId, sentById } = params;
    
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Görüşme bulunamadı');

    const quotedMessage = await this.prisma.message.findUnique({ where: { id: quotedMessageId } });
    if (!quotedMessage || !quotedMessage.waMessageId) {
      throw new BadRequestException('Yanıt verilecek mesaj bulunamadı veya WAHA ID eksik');
    }

    const waResponse = await this.wahaService.sendReply(
      sessionName,
      chatId,
      body,
      quotedMessage.waMessageId,
    );

    const waMessageId = this.extractWaMessageId(waResponse);
    const message = await this.persistMessage({
      conversationId,
      sessionId: conversation.sessionId,
      waMessageId,
      direction: MessageDirection.OUTGOING,
      body,
      status: MessageStatus.SENT,
      sentById,
      metadata: {
        replyToMessageId: quotedMessage.id,
        replyToWaMessageId: quotedMessage.waMessageId,
        replyToBody: quotedMessage.body || null,
        replyToMediaType: quotedMessage.mediaType || null,
      },
    });

    this.emitAndUpdateList(conversationId, message, body);
    return message;
  }

  /** WAHA Plus - Mesaj silme */
  async deleteMessage(params: {
    messageId: string;
    sessionName: string;
    chatId: string;
    forEveryone?: boolean;
  }) {
    const { messageId, sessionName, chatId, forEveryone = true } = params;
    
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Mesaj bulunamadı');
    if (!message.waMessageId) throw new BadRequestException('WAHA mesaj ID bulunamadı');

    try {
      await this.wahaService.deleteMessage(sessionName, chatId, message.waMessageId, forEveryone);
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || '';
      if (errMsg.includes('Plus version') || errMsg.includes('not support')) {
        throw new BadRequestException('Mesaj silme WAHA Plus gerektirir.');
      }
      throw new BadRequestException(errMsg || 'Mesaj silinemedi');
    }

    // Mesajı satırdan kaldırmak yerine "silindi" durumuna geçir (UI'da görünür kalsın).
    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        body: 'Bu mesaj silindi',
        mediaType: null,
        mediaUrl: null,
        metadata: {
          ...((message.metadata as any) || {}),
          deleted: true,
        } as any,
      },
    });

    // Socket ile bildir
    this.chatGateway.server
      .to(`conversation:${message.conversationId}`)
      .emit('message:deleted', { messageId });

    return { deleted: true };
  }

  /** WAHA Plus - Emoji tepki gönder */
  async sendReaction(params: {
    messageId: string;
    sessionName: string;
    chatId: string;
    emoji: string;
    userId?: string;
    userName?: string;
  }) {
    const { messageId, sessionName, chatId, emoji, userId, userName } = params;
    
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Mesaj bulunamadı');
    if (!message.waMessageId) throw new BadRequestException('WAHA mesaj ID bulunamadı');

    try {
      await this.wahaService.sendReaction(sessionName, chatId, message.waMessageId, emoji);
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || '';
      if (errMsg.includes('Plus version') || errMsg.includes('not support')) {
        throw new BadRequestException('Tepki gönderme WAHA Plus gerektirir.');
      }
      if (String(errMsg).includes('Cannot POST /api/reaction')) {
        throw new BadRequestException(
          'WAHA reaction endpoint bu sürümde bulunamadı. Backend güncellendi; container yeniden build/restart sonrası tekrar deneyin.',
        );
      }
      throw new BadRequestException(errMsg || 'Tepki gönderilemedi');
    }

    const existing = (message.reactions as any[]) || [];
    const senderKey = userId ? `user:${userId}` : `self:${sessionName}`;
    const displayName = userName?.trim() || 'Siz';
    const next = [...existing];
    const idx = next.findIndex((r: any) => r?.sender === senderKey);
    if (!emoji) {
      if (idx >= 0) next.splice(idx, 1);
    } else {
      const item = { emoji, sender: senderKey, senderName: displayName, timestamp: Date.now() };
      if (idx >= 0) next[idx] = item;
      else next.push(item);
    }
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { reactions: next.length ? (next as any) : null },
      select: { id: true, waMessageId: true, reactions: true, conversationId: true },
    });
    this.chatGateway.server.to(`conversation:${message.conversationId}`).emit('message:reaction', {
      messageId: updated.id,
      waMessageId: updated.waMessageId,
      reactions: updated.reactions || [],
    });
    return { success: true };
  }

  /** WAHA Plus - Konum gönder */
  async sendLocation(params: {
    conversationId: string;
    sessionName: string;
    chatId: string;
    latitude: number;
    longitude: number;
    title?: string;
    address?: string;
    sentById?: string;
  }) {
    const { conversationId, sessionName, chatId, latitude, longitude, title, address, sentById } = params;

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Görüşme bulunamadı');

    const waResponse = await this.wahaService.sendLocation(
      sessionName,
      chatId,
      latitude,
      longitude,
      title,
      address,
    );

    const waMessageId = this.extractWaMessageId(waResponse);
    const locationText = title || address || `📍 ${latitude}, ${longitude}`;
    const mapsUrl = `https://maps.google.com/?q=${latitude},${longitude}`;
    
    const message = await this.persistMessage({
      conversationId,
      sessionId: conversation.sessionId,
      waMessageId,
      direction: MessageDirection.OUTGOING,
      body: locationText,
      status: MessageStatus.SENT,
      sentById,
      metadata: {
        kind: 'location',
        latitude,
        longitude,
        title: title || null,
        address: address || null,
        mapsUrl,
      },
    });

    this.emitAndUpdateList(conversationId, message, locationText);
    return message;
  }

  async sendContact(params: {
    conversationId: string;
    sessionName: string;
    chatId: string;
    contactName: string;
    contactPhone: string;
    sentById?: string;
  }) {
    const { conversationId, sessionName, chatId, contactName, contactPhone, sentById } = params;
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Görüşme bulunamadı');
    const normalizedPhone = String(contactPhone || '').replace(/\D/g, '');
    if (!normalizedPhone) throw new BadRequestException('Geçerli kişi telefonu gerekli');
    const safeName = (contactName || '').trim() || normalizedPhone;
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${safeName}`,
      `TEL;TYPE=CELL:${normalizedPhone}`,
      'END:VCARD',
    ].join('\n');

    const waResponse = await this.callWahaSendText(sessionName, normalizeWhatsappChatId(chatId), vcard);
    const waMessageId = this.extractWaMessageId(waResponse);
    const message = await this.persistMessage({
      conversationId,
      sessionId: conversation.sessionId,
      waMessageId,
      direction: MessageDirection.OUTGOING,
      body: '👤 Kişi kartı',
      status: MessageStatus.SENT,
      sentById,
      mediaType: 'DOCUMENT',
      metadata: {
        kind: 'vcard',
        contactName: safeName,
        contactPhone: normalizedPhone,
        vcard,
      },
    });

    this.emitAndUpdateList(conversationId, message, `${safeName} (${normalizedPhone})`);
    return message;
  }
}
