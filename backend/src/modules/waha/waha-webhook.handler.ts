import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WahaService } from './waha.service';
import { ChatGateway } from '../websocket/chat.gateway';
import { AutoReplyEngineService } from '../auto-reply/auto-reply-engine.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MessageDirection, MessageStatus, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { v4 as uuid } from 'uuid';
import axios from 'axios';
import {
  collectWhatsappMessageText,
  isWhatsappE2eOrSecuritySystemText,
} from '../../common/whatsapp-system-message';

@Injectable()
export class WahaWebhookHandler {
  private readonly logger = new Logger(WahaWebhookHandler.name);

  private readonly wahaApiUrl: string;

  constructor(
    private prisma: PrismaService,
    private contactsService: ContactsService,
    private conversationsService: ConversationsService,
    private wahaService: WahaService,
    private chatGateway: ChatGateway,
    private config: ConfigService,
    @Inject(forwardRef(() => AutoReplyEngineService))
    private autoReplyEngine: AutoReplyEngineService,
    private auditLog: AuditLogService,
  ) {
    this.wahaApiUrl = this.config.get('WAHA_API_URL', 'http://localhost:3001');
  }

  async handleMessage(payload: any) {
    try {
      const { session: sessionName, payload: msg } = payload;

      if (!msg) return;

      const isFromMe = !!msg.fromMe;
      const chatId = isFromMe ? (msg.to || msg.from) : msg.from;
      if (!chatId || chatId.includes('@g.us')) return;

      if (chatId === 'status@broadcast' || chatId.includes('@broadcast')) return;

      const skipTypes = new Set([
        'e2e_notification', 'notification_template', 'call_log',
        'gp2', 'protocol', 'revoked', 'ciphertext',
        'notification', 'groups_v4_invite', 'security', 'status',
      ]);
      if (msg.isStatus || skipTypes.has(msg.type)) return;
      if (msg._data?.type === 'e2e_notification') return;

      const bodyText = msg.body || '';
      if (bodyText.match(/^\d{10,15}@[cgs]\.us$/)) return;
      if (
        isWhatsappE2eOrSecuritySystemText(collectWhatsappMessageText(msg))
      ) {
        return;
      }

      const phone = this.wahaService.extractPhoneFromChatId(chatId);
      const contactName = msg.pushName || msg._data?.notifyName || phone;

      const contact = await this.contactsService.findOrCreate(phone, contactName);

      if (!contact.avatarUrl) {
        this.fetchAndSaveAvatar(sessionName, phone, contact.id).catch(() => {});
      }

      const waSession = await this.prisma.whatsappSession.findUnique({
        where: { name: sessionName },
      });
      if (!waSession) {
        this.logger.warn(`Session not found: ${sessionName}`);
        return;
      }

      const conversation = await this.conversationsService.findOrCreate(
        contact.id,
        waSession.id,
      );

      let mediaUrl: string | undefined;
      let mediaType: string | undefined;
      let mediaMimeType: string | undefined;

      const hasMediaFlag = msg.hasMedia || msg.mediaUrl || msg._data?.mediaUrl || msg.media;
      const isMediaType = ['image', 'sticker', 'video', 'audio', 'ptt', 'document'].includes(msg.type);

      if (hasMediaFlag || isMediaType) {
        mediaMimeType = msg.mimetype || msg._data?.mimetype;

        if (mediaMimeType?.startsWith('image/')) mediaType = 'IMAGE';
        else if (mediaMimeType?.startsWith('video/')) mediaType = 'VIDEO';
        else if (mediaMimeType?.startsWith('audio/')) mediaType = 'AUDIO';
        else if (msg.type === 'image' || msg.type === 'sticker') mediaType = 'IMAGE';
        else if (msg.type === 'video') mediaType = 'VIDEO';
        else if (msg.type === 'audio' || msg.type === 'ptt') mediaType = 'AUDIO';
        else if (msg.hasMedia || msg.type === 'document') mediaType = 'DOCUMENT';

        const base64Data = msg.media?.data || msg._data?.body || msg.body;
        if (base64Data && typeof base64Data === 'string' && base64Data.length > 200) {
          mediaUrl = await this.saveBase64Media(base64Data, mediaMimeType);
        }

        if (!mediaUrl) {
          const remoteUrl =
            msg.mediaUrl || msg._data?.mediaUrl || msg.media?.url;
          if (remoteUrl) {
            mediaUrl = await this.downloadAndSaveMedia(remoteUrl, mediaMimeType);
          }
        }

        this.logger.debug(
          `Media detected: type=${msg.type} hasMedia=${msg.hasMedia} mimetype=${mediaMimeType} saved=${mediaUrl}`,
        );
      }

      const waMessageId = msg.id?._serialized || msg.id;
      const direction = isFromMe ? MessageDirection.OUTGOING : MessageDirection.INCOMING;
      const messageData = {
        conversationId: conversation.id,
        sessionId: waSession.id,
        waMessageId,
        direction,
        body: msg.body || '',
        mediaUrl,
        mediaType: mediaType as any,
        mediaMimeType,
        status: isFromMe ? MessageStatus.SENT : MessageStatus.DELIVERED,
        timestamp: msg.timestamp ? new Date(msg.timestamp * 1000) : new Date(),
      };

      const message = await this.prisma.message.upsert({
        where: { waMessageId },
        create: messageData,
        update: {},
        include: {
          sentBy: { select: { id: true, name: true } },
        },
      });

      const bodyPreview = msg.body || (mediaType ? `📎 ${mediaType}` : '');
      const msgTimestamp = msg.timestamp ? new Date(msg.timestamp * 1000) : new Date();
      await this.conversationsService.updateLastMessage(
        conversation.id,
        bodyPreview,
        msgTimestamp,
      );

      if (!isFromMe) {
        await this.conversationsService.incrementUnread(conversation.id);
      }

      const fullConversation = await this.conversationsService.findById(
        conversation.id,
      );

      this.chatGateway.emitNewMessage(conversation.id, {
        message,
        conversation: fullConversation,
      });

      if (!isFromMe) {
        if (!fullConversation.assignments?.length) {
          await this.conversationsService.autoAssignRoundRobin(conversation.id);
        }

        const msgCount = await this.prisma.message.count({
          where: { conversationId: conversation.id, direction: 'INCOMING' },
        });
        this.autoReplyEngine
          .processIncomingMessage({
            sessionName,
            chatId,
            messageBody: msg.body || '',
            conversationId: conversation.id,
            contactId: contact.id,
            isFirstMessage: msgCount <= 1,
          })
          .catch((err) =>
            this.logger.error(`Otomatik yanıt hatası: ${err.message}`),
          );
      }

      this.logger.log(
        `${isFromMe ? 'Outgoing' : 'Incoming'} message ${isFromMe ? 'to' : 'from'} ${phone} on session ${sessionName}` +
          (mediaType ? ` [${mediaType}]` : ''),
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to handle incoming message: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async handleReaction(payload: any) {
    try {
      const reaction = payload.payload;
      if (!reaction) return;

      const reactionMsgId = reaction.reaction?.messageId?._serialized
        || reaction.reaction?.messageId
        || reaction.msgId?._serialized
        || reaction.msgId;

      if (!reactionMsgId) {
        this.logger.debug('Reaction: messageId bulunamadı');
        return;
      }

      const emoji = reaction.reaction?.text || reaction.text || '';
      const sender = reaction.from || reaction.participant || '';
      const senderName = reaction.pushName || reaction._data?.notifyName || sender;

      const message = await this.prisma.message.findFirst({
        where: { waMessageId: reactionMsgId },
      });

      if (!message) {
        this.logger.debug(`Reaction: mesaj bulunamadı (${reactionMsgId})`);
        return;
      }

      const reactions = (message.reactions as any[]) || [];
      const existingIdx = reactions.findIndex((r: any) => r.sender === sender);

      if (!emoji) {
        if (existingIdx >= 0) reactions.splice(existingIdx, 1);
      } else {
        if (existingIdx >= 0) {
          reactions[existingIdx] = { emoji, sender, senderName, timestamp: Date.now() };
        } else {
          reactions.push({ emoji, sender, senderName, timestamp: Date.now() });
        }
      }

      await this.prisma.message.update({
        where: { id: message.id },
        data: { reactions: reactions.length > 0 ? reactions : Prisma.JsonNull },
      });

      this.chatGateway.server
        .to(`conversation:${message.conversationId}`)
        .emit('message:reaction', {
          messageId: message.id,
          waMessageId: reactionMsgId,
          reactions,
        });

      this.logger.debug(`Reaction ${emoji || '(removed)'} on ${reactionMsgId} by ${senderName}`);
    } catch (error: any) {
      this.logger.error('Failed to handle reaction', error.message);
    }
  }

  async handleMessageAck(payload: any) {
    try {
      const ack = payload.payload;
      if (!ack) return;

      const waMessageId =
        ack.id?._serialized || ack.id || ack.key?.id;
      if (!waMessageId) return;

      const ackNameMap: Record<string, number> = {
        PENDING: 0,
        SERVER: 1,
        DEVICE: 2,
        READ: 3,
        PLAYED: 4,
      };
      const ackValue =
        typeof ack.ack === 'number'
          ? ack.ack
          : typeof ack.ackName === 'string'
            ? ackNameMap[ack.ackName] ?? -1
            : -1;

      let status: MessageStatus;
      switch (ackValue) {
        case 1:
          status = MessageStatus.SENT;
          break;
        case 2:
          status = MessageStatus.DELIVERED;
          break;
        case 3:
        case 4:
          status = MessageStatus.READ;
          break;
        default:
          return;
      }

      const result = await this.prisma.message.updateMany({
        where: { waMessageId },
        data: { status },
      });

      if (result.count === 0) return;

      const message = await this.prisma.message.findFirst({
        where: { waMessageId },
      });
      if (message) {
        this.chatGateway.emitMessageStatus(message.conversationId, {
          messageId: message.id,
          waMessageId,
          status,
        });
      }

      this.logger.debug(`Ack ${ackValue} -> ${status} for ${waMessageId}`);
    } catch (error: any) {
      this.logger.error('Failed to handle message ack', error.message);
    }
  }

  private getExtFromMime(mimetype?: string): string {
    if (!mimetype) return '.bin';
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'audio/ogg': '.ogg',
      'audio/mpeg': '.mp3',
      'application/pdf': '.pdf',
    };
    return map[mimetype] || '.bin';
  }

  private ensureUploadsDir(): string {
    const dir = join(process.cwd(), 'uploads');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  private async saveBase64Media(
    base64Data: string,
    mimetype?: string,
  ): Promise<string | undefined> {
    try {
      const dir = this.ensureUploadsDir();
      const ext = this.getExtFromMime(mimetype);
      const filename = `${uuid()}${ext}`;
      const filePath = join(dir, filename);
      writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
      this.logger.debug(`Saved base64 media: ${filename} (${ext})`);
      return `/uploads/${filename}`;
    } catch (err: any) {
      this.logger.error(`Failed to save base64 media: ${err.message}`);
      return undefined;
    }
  }

  private isAllowedUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254'];
      if (blocked.includes(parsed.hostname)) return false;
      if (parsed.hostname.startsWith('10.') || parsed.hostname.startsWith('192.168.')) return false;
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      return true;
    } catch {
      return false;
    }
  }

  private async downloadAndSaveMedia(
    url: string,
    mimetype?: string,
  ): Promise<string | undefined> {
    try {
      if (!this.isAllowedUrl(url)) {
        const wahaHost = new URL(this.wahaApiUrl).hostname;
        const urlHost = new URL(url).hostname;
        if (urlHost !== wahaHost) {
          this.logger.warn(`Blocked media download from: ${url}`);
          return undefined;
        }
      }

      const dir = this.ensureUploadsDir();
      const ext = this.getExtFromMime(mimetype);
      const filename = `${uuid()}${ext}`;
      const filePath = join(dir, filename);

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024,
      });

      writeFileSync(filePath, Buffer.from(response.data));
      this.logger.debug(`Downloaded media: ${filename} from ${url}`);
      return `/uploads/${filename}`;
    } catch (err: any) {
      this.logger.error(`Failed to download media from ${url}: ${err.message}`);
      return undefined;
    }
  }

  private async fetchAndSaveAvatar(
    sessionName: string,
    phone: string,
    contactId: string,
  ) {
    try {
      const pictureUrl = await this.wahaService.getProfilePicture(sessionName, phone);
      if (pictureUrl) {
        await this.contactsService.fetchAndSaveProfilePicture(contactId, phone, pictureUrl);
        this.logger.debug(`Profil fotoğrafı kaydedildi: ${phone}`);
      }
    } catch (err: any) {
      this.logger.debug(`Avatar alınamadı (${phone}): ${err.message}`);
    }
  }

  async handleSessionStatus(payload: any) {
    try {
      const { session: sessionName, payload: statusData } = payload;
      const status = statusData?.status;

      const statusMap: Record<string, string> = {
        STARTING: 'STARTING',
        SCAN_QR_CODE: 'SCAN_QR',
        WORKING: 'WORKING',
        STOPPED: 'STOPPED',
        FAILED: 'FAILED',
      };

      const mappedStatus = statusMap[status] || 'STOPPED';

      const session = await this.prisma.whatsappSession.upsert({
        where: { name: sessionName },
        update: { status: mappedStatus as any },
        create: { name: sessionName, status: mappedStatus as any },
      });

      this.chatGateway.emitSessionStatus(sessionName, mappedStatus, session.organizationId);

      this.logger.log(`Session ${sessionName} status: ${mappedStatus}`);
    } catch (error: any) {
      this.logger.error('Failed to handle session status', error.message);
    }
  }
}
