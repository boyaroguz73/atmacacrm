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
import {
  collectWhatsappMessageText,
  isWhatsappE2eOrSecuritySystemText,
} from '../../common/whatsapp-system-message';
import {
  isGroupChat,
  isProcessableChat,
  extractPhoneFromIndividualJid,
  extractPhoneFromParticipant,
  isValidPhoneNumber,
  isLidChat,
  lidJidToContactPhone,
  contactPhoneLookupKeys,
  isFallbackContactName,
} from '../../common/contact-phone';

function splitPushName(displayName: string): { firstName: string; lastName: string | null } {
  const parts = displayName.trim().split(/\s+/);
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

function extractGroupNameFromWahaMessage(msg: any): string {
  const candidates = [
    msg?.chat?.name,
    msg?.chat?.subject,
    msg?._data?.chat?.name,
    msg?._data?.chat?.subject,
    msg?._data?.subject,
    msg?.chat?.groupMetadata?.subject,
    msg?.groupMetadata?.subject,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

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
      if (!chatId) return;

      // İşlenebilir sohbet tipi mi kontrol et (bireysel @c.us veya grup @g.us)
      if (!isProcessableChat(chatId)) {
        this.logger.debug(`İşlenemeyen sohbet tipi atlandı: ${chatId}`);
        return;
      }

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

      const waSession = await this.prisma.whatsappSession.findUnique({
        where: { name: sessionName },
      });
      if (!waSession) {
        this.logger.warn(`Session not found: ${sessionName}`);
        return;
      }

      // Grup mu bireysel mi belirleme
      const isGroup = isGroupChat(chatId);
      let contact: any;
      let conversation: any;
      let participantPhone: string | null = null;
      let participantName: string | null = null;
      let phone: string | null = null;

      if (isGroup) {
        // ─────────────────────────────────────────────────────────────
        // GRUP MESAJI İŞLEME
        // ─────────────────────────────────────────────────────────────
        
        // Grup için participant bilgisini al (mesajı gönderen kişi)
        const rawParticipant = msg.author || msg.participant || msg._data?.author || msg._data?.participant;
        participantPhone = extractPhoneFromParticipant(rawParticipant);
        participantName =
          msg.pushName ||
          msg._data?.notifyName ||
          msg._data?.pushName ||
          (typeof rawParticipant === 'string' && /@lid$/i.test(rawParticipant) ? 'WhatsApp kullanıcısı' : null);

        let groupName = extractGroupNameFromWahaMessage(msg);
        if (!groupName) {
          const meta = await this.wahaService
            .getGroupById(sessionName, chatId)
            .catch(() => null);
          const subject =
            (typeof meta?.subject === 'string' && meta.subject.trim()) ||
            (typeof meta?.name === 'string' && meta.name.trim()) ||
            '';
          if (subject) groupName = subject;
        }
        if (!groupName) {
          groupName = 'Grup';
        }

        // Kayıtlı müşteri adı (TR numara) — grup mesajında gönderen satırı
        if (
          participantPhone &&
          !participantPhone.startsWith('lid:') &&
          !participantName
        ) {
          const keys = contactPhoneLookupKeys(participantPhone);
          const peer = await this.prisma.contact.findFirst({
            where: { phone: { in: keys } },
            select: { name: true, surname: true },
          });
          if (peer?.name || peer?.surname) {
            participantName = [peer.name, peer.surname].filter(Boolean).join(' ') || null;
          }
        }
        if (participantPhone?.startsWith('lid:') && !participantName) {
          const lidPeer = await this.prisma.contact.findFirst({
            where: { phone: participantPhone },
            select: { name: true, surname: true },
          });
          if (lidPeer?.name || lidPeer?.surname) {
            participantName =
              [lidPeer.name, lidPeer.surname].filter(Boolean).join(' ') || null;
          }
        }

        // Grup için placeholder contact oluştur/bul
        contact = await this.contactsService.findOrCreateForGroup(
          chatId,
          groupName,
          waSession.organizationId,
        );

        // Grup conversation bul/oluştur
        conversation = await this.conversationsService.findOrCreateGroup(
          contact.id,
          waSession.id,
          chatId,
          groupName,
        );

        this.logger.debug(
          `Grup mesajı: ${chatId} | Gönderen: ${participantPhone || 'bilinmiyor'} (${participantName || 'adsız'})`,
        );
      } else if (isLidChat(chatId)) {
        // ─────────────────────────────────────────────────────────────
        // LID (@lid) — WhatsApp iç kimliği
        // Onceden WAHA'dan numara cozumlemesi yap; basarili olursa contact'i
        // numara ile olustur (duplicate'lari onler). Yoksa lid:xxx fallback.
        // ─────────────────────────────────────────────────────────────
        const lidKey = lidJidToContactPhone(chatId);
        if (!lidKey) {
          this.logger.warn(`LID çıkarılamadı: ${chatId}`);
          return;
        }
        const displayName =
          msg.pushName || msg._data?.notifyName || msg.notifyName || undefined;

        // LID -> numara cozumlemesini hizlica dene
        let resolvedPhone: string | null = null;
        try {
          const pnJid = await this.wahaService.getLinkedPnFromLid(sessionName, chatId);
          if (pnJid) {
            const extracted = extractPhoneFromIndividualJid(pnJid);
            if (extracted && isValidPhoneNumber(extracted)) {
              resolvedPhone = extracted;
            }
          }
        } catch { /* WAHA timeout/hata - LID fallback */ }

        if (resolvedPhone) {
          // Numara ile findOrCreate — mevcut kaydi bulur, duplicate yaratmaz
          phone = resolvedPhone;
          contact = await this.contactsService.findOrCreate(
            resolvedPhone,
            displayName,
            waSession.organizationId,
          );
        } else {
          // WAHA cevap vermedi - LID anahtariyla olustur; cleanupLidDuplicates sonra merge eder
          contact = await this.contactsService.findOrCreate(
            lidKey,
            displayName,
            waSession.organizationId,
          );
        }

        if (displayName && isFallbackContactName(contact.name, contact.phone) && !contact.surname?.trim()) {
          const { firstName, lastName } = splitPushName(displayName);
          try {
            contact = await this.prisma.contact.update({
              where: { id: contact.id },
              data: { name: firstName, surname: lastName },
            });
          } catch { /* unique constraint veya başka hata — mevcut kaydı koru */ }
        }

        if (resolvedPhone && !contact.avatarUrl) {
          this.fetchAndSaveAvatar(sessionName, resolvedPhone, contact.id).catch(() => {});
        }

        conversation = await this.conversationsService.findOrCreate(
          contact.id,
          waSession.id,
        );
      } else {
        // ─────────────────────────────────────────────────────────────
        // BİREYSEL MESAJ İŞLEME (@c.us)
        // ─────────────────────────────────────────────────────────────

        phone = extractPhoneFromIndividualJid(chatId);

        if (!phone || !isValidPhoneNumber(phone)) {
          this.logger.warn(`Geçersiz telefon numarası, chatId=${chatId}, çıkarılan=${phone}`);
          return;
        }

        const displayName =
          msg.pushName ||
          msg._data?.notifyName ||
          msg.notifyName ||
          undefined;

        contact = await this.contactsService.findOrCreate(
          phone,
          displayName,
          waSession.organizationId,
        );

        if (displayName && isFallbackContactName(contact.name, contact.phone) && !contact.surname?.trim()) {
          const { firstName, lastName } = splitPushName(displayName);
          try {
            contact = await this.prisma.contact.update({
              where: { id: contact.id },
              data: { name: firstName, surname: lastName },
            });
          } catch { /* unique constraint — mevcut kaydı koru */ }
        }

        if (!contact.avatarUrl) {
          this.fetchAndSaveAvatar(sessionName, phone, contact.id).catch(() => {});
        }

        conversation = await this.conversationsService.findOrCreate(
          contact.id,
          waSession.id,
        );
      }

      // ─────────────────────────────────────────────────────────────
      // MEDYA İŞLEME (her iki tip için ortak)
      // ─────────────────────────────────────────────────────────────
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

        // WAHA tam boyutlu URL varsa indirip local'e kaydet
        const wahaStoredUrl = msg.media?.url || msg.mediaUrl || msg._data?.mediaUrl;
        if (wahaStoredUrl) {
          mediaUrl = await this.downloadAndSaveMedia(String(wahaStoredUrl), mediaMimeType);
        }

        // URL yoksa files proxy kullan — frontend acildiginda WAHA'dan tam boyutu ceker.
        // Webhook'tan gelen base64 (msg.media.data / _data.body / body) genelde thumbnail olup
        // dusuk cozunurluk uretir, bu yuzden base64 fallback tamamen devre disi.
        if (!mediaUrl) {
          const rawId = msg.id?._serialized || msg.id?.id || msg.id;
          const waMessageId = typeof rawId === 'string' ? rawId : String(rawId ?? '');
          if (waMessageId) {
            const ext = this.getExtFromMime(mediaMimeType);
            mediaUrl = `/api/files/${sessionName}/${waMessageId}${ext}`;
          }
        }

        this.logger.debug(
          `Media detected: type=${msg.type} hasMedia=${msg.hasMedia} mimetype=${mediaMimeType} saved=${mediaUrl}`,
        );
      }

      // ─────────────────────────────────────────────────────────────
      // MESAJ KAYDI
      // ─────────────────────────────────────────────────────────────
      const rawId = msg.id?._serialized || msg.id?.id || msg.id;
      const waMessageId = typeof rawId === 'string' ? rawId : String(rawId ?? '');
      const direction = isFromMe ? MessageDirection.OUTGOING : MessageDirection.INCOMING;
      
      const messageData: any = {
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

      // Grup mesajı: gönderen (gelen); giden için oturum tarafı etiketi UI'da "Siz"
      if (isGroup) {
        if (!isFromMe) {
          messageData.participantPhone = participantPhone;
          messageData.participantName = participantName;
        } else {
          messageData.participantName = 'Siz';
        }
      }

      const message = await this.prisma.message.upsert({
        where: { waMessageId },
        create: messageData,
        update: {},
        include: {
          sentBy: { select: { id: true, name: true } },
        },
      });

      // ─────────────────────────────────────────────────────────────
      // CONVERSATION GÜNCELLEME
      // ─────────────────────────────────────────────────────────────
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

      // WebSocket emit
      this.chatGateway.emitNewMessage(conversation.id, {
        message,
        conversation: fullConversation,
      });

      // ─────────────────────────────────────────────────────────────
      // OTOMATİK YANITLAR (sadece bireysel için, gruplar için değil)
      // ─────────────────────────────────────────────────────────────
      if (!isFromMe && !isGroup) {
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

      const logIdentifier = isGroup 
        ? `grup ${chatId.split('@')[0]}` 
        : (phone || contact.phone || chatId);
      this.logger.log(
        `${isFromMe ? 'Outgoing' : 'Incoming'} ${isGroup ? 'grup ' : ''}message ${isFromMe ? 'to' : 'from'} ${logIdentifier} on session ${sessionName}` +
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
      let raw = base64Data.replace(/\s/g, '');
      const dataPrefix = raw.indexOf('base64,');
      if (dataPrefix !== -1) raw = raw.slice(dataPrefix + 7);
      const dir = this.ensureUploadsDir();
      const ext = this.getExtFromMime(mimetype);
      const filename = `${uuid()}${ext}`;
      const filePath = join(dir, filename);
      writeFileSync(filePath, Buffer.from(raw, 'base64'));
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

      const buf = await this.wahaService.downloadMediaBuffer(url);
      if (!buf?.length) {
        this.logger.warn(`Medya indirilemedi veya boş: ${url}`);
        return undefined;
      }
      writeFileSync(filePath, buf);
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
