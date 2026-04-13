import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WahaService } from '../waha/waha.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ChatGateway } from '../websocket/chat.gateway';
import { ConfigService } from '@nestjs/config';
import { MessageDirection, MessageStatus } from '@prisma/client';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { lookup } from 'mime-types';

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
      },
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

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new Error('Conversation not found');

    let waResponse: any;
    try {
      waResponse = await this.wahaService.sendText(sessionName, chatId, body);
    } catch (err: any) {
      const d = err.response?.data;
      const msg =
        (typeof d?.message === 'string' && d.message) ||
        (typeof d?.error === 'string' && d.error) ||
        (typeof d === 'string' && d) ||
        (Array.isArray(d?.message) ? d.message.join(', ') : null) ||
        err.message ||
        'WhatsApp üzerinden mesaj gönderilemedi (WAHA).';
      this.logger.warn(`sendText WAHA hata: ${msg}`);
      throw new BadRequestException(msg);
    }

    const waMessageId = this.extractWaMessageId(waResponse);
    this.logger.debug(`WAHA sendText response waMessageId: ${waMessageId}`);

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        sessionId: conversation.sessionId,
        waMessageId,
        direction: MessageDirection.OUTGOING,
        body,
        status: MessageStatus.SENT,
        sentById,
      },
      include: {
        sentBy: { select: { id: true, name: true } },
      },
    });

    await this.conversationsService.updateLastMessage(conversationId, body);

    const fullConversation =
      await this.conversationsService.findById(conversationId);
    this.chatGateway.emitNewMessage(conversationId, {
      message,
      conversation: fullConversation,
    });

    return message;
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
    const {
      conversationId,
      sessionName,
      chatId,
      mediaUrl,
      caption,
      sentById,
    } = params;

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new Error('Conversation not found');

    const localPath = this.resolveLocalPath(mediaUrl);
    if (!localPath || !existsSync(localPath)) {
      this.logger.error(`Media file not found: ${mediaUrl} -> ${localPath}`);
      throw new Error('Media file not found on server');
    }

    const fileBuffer = readFileSync(localPath);
    const base64Data = fileBuffer.toString('base64');
    const ext = extname(localPath);
    const mimetype = (lookup(ext) as string) || 'application/octet-stream';
    const originalFilename = localPath.split(/[\\/]/).pop() || `file${ext}`;

    const { mediaType, preview } = this.detectMediaType(mimetype);

    this.logger.debug(
      `Sending media: file=${localPath} size=${fileBuffer.length} mimetype=${mimetype} type=${mediaType}`,
    );

    let waResponse: any;
    try {
      if (mediaType === 'IMAGE') {
        waResponse = await this.wahaService.sendImage(
          sessionName,
          chatId,
          { mimetype, data: base64Data, filename: originalFilename },
          caption,
        );
      } else {
        waResponse = await this.wahaService.sendFile(
          sessionName,
          chatId,
          { mimetype, data: base64Data, filename: originalFilename },
          caption,
        );
      }
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || '';
      if (errMsg.includes('Plus version')) {
        throw new Error(
          'Bu dosya tipi WAHA ücretsiz sürümde desteklenmiyor. WAHA Plus gereklidir.',
        );
      }
      throw err;
    }

    const waMessageId = this.extractWaMessageId(waResponse);
    this.logger.debug(`WAHA send response waMessageId: ${waMessageId}`);

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        sessionId: conversation.sessionId,
        waMessageId,
        direction: MessageDirection.OUTGOING,
        body: caption || '',
        mediaUrl,
        mediaType: mediaType as any,
        status: MessageStatus.SENT,
        sentById,
      },
      include: {
        sentBy: { select: { id: true, name: true } },
      },
    });

    await this.conversationsService.updateLastMessage(
      conversationId,
      caption || preview,
    );

    const fullConversation =
      await this.conversationsService.findById(conversationId);
    this.chatGateway.emitNewMessage(conversationId, {
      message,
      conversation: fullConversation,
    });

    return message;
  }

  private resolveLocalPath(mediaUrl: string): string | null {
    if (mediaUrl.includes('/uploads/')) {
      const filename = mediaUrl.split('/uploads/').pop();
      if (filename) {
        return join(process.cwd(), 'uploads', filename);
      }
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
    const message = await this.prisma.message.create({
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
      include: {
        sentBy: { select: { id: true, name: true } },
      },
    });

    return message;
  }

  async editMessage(params: {
    messageId: string;
    sessionName: string;
    chatId: string;
    newBody: string;
    userId: string;
  }) {
    const { messageId, sessionName, chatId, newBody, userId } = params;

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new Error('Mesaj bulunamadı');
    if (message.direction !== 'OUTGOING') throw new Error('Sadece giden mesajlar düzenlenebilir');
    if (!message.waMessageId) throw new Error('WAHA mesaj ID bulunamadı');

    try {
      await this.wahaService.editMessage(
        sessionName,
        chatId,
        message.waMessageId,
        newBody,
      );
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || '';
      if (errMsg.includes('Plus version') || errMsg.includes('not support')) {
        throw new Error('Mesaj düzenleme WAHA Plus gerektirir.');
      }
      throw err;
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
