import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
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

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private prisma: PrismaService,
    private wahaService: WahaService,
    private conversationsService: ConversationsService,
    private chatGateway: ChatGateway,
    private config: ConfigService,
  ) {}

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
    },
  ) {
    const { waMessageId, ...rest } = data;

    if (waMessageId) {
      return this.prisma.message.upsert({
        where: { waMessageId },
        create: { ...rest, waMessageId },
        update: { sentById: rest.sentById || undefined },
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
      include: { sentBy: { select: { id: true, name: true } } },
    });

    return {
      messages: messages.reverse(),
      nextCursor: messages.length === limit ? messages[0]?.id : null,
    };
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
    try {
      if (mediaType === 'IMAGE') {
        const opt = await optimizeImageBufferForWhatsapp(fileBuffer);
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
    });

    this.emitAndUpdateList(conversationId, message, caption || preview);
    return message;
  }

  /** Ürün ana görselini indirip WhatsApp’ta gönderir (sohbet ürün paylaşımı) */
  async sendProductShare(params: {
    conversationId: string;
    productId: string;
    sentById: string;
    sessionName?: string;
    chatId?: string;
  }) {
    const { conversationId, productId, sentById } = params;
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
    const url = (product.imageUrl || '').trim();
    if (!url) {
      throw new BadRequestException(
        'Bu üründe görsel URL yok. XML akışında image_link veya additional_image_link olmalı.',
      );
    }

    const dir = join(process.cwd(), 'uploads', 'product-shares');
    mkdirSync(dir, { recursive: true });
    const lower = url.toLowerCase();
    const ext =
      lower.includes('.png') ? '.png' : lower.includes('.webp') ? '.webp' : lower.includes('.gif') ? '.gif' : '.jpg';
    const filename = `${uuid()}${ext}`;
    const fullPath = join(dir, filename);

    try {
      const res = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 90_000,
        maxContentLength: 12 * 1024 * 1024,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: { 'User-Agent': 'AtmacaCRM-ProductShare/1.0' },
      });
      writeFileSync(fullPath, Buffer.from(res.data));
    } catch (e: any) {
      const msg = axios.isAxiosError(e)
        ? `${e.message}${e.response ? ` (HTTP ${e.response.status})` : ''}`
        : e?.message || String(e);
      throw new BadRequestException(`Ürün görseli indirilemedi: ${msg}`);
    }

    const mediaUrl = `/uploads/product-shares/${filename}`;
    const price = `${product.unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${product.currency}`;
    const cat = (product.category || product.googleProductType || '').trim();
    const caption =
      `${product.name}\nSKU: ${product.sku}` +
      (cat ? `\nKategori: ${cat}` : '') +
      `\nFiyat: ${price}` +
      (product.productUrl ? `\n${product.productUrl}` : '');

    return this.sendMedia({
      conversationId,
      sessionName,
      chatId,
      mediaUrl,
      caption,
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
}
