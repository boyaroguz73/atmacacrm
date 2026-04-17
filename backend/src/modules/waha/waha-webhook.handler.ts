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
  isLikelyLidPhone,
  canonicalContactPhone,
  contactPhoneLookupKeys,
  isFallbackContactName,
} from '../../common/contact-phone';

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

function parseVcardPayload(raw: string): { contactName: string | null; contactPhone: string | null } {
  const text = String(raw || '');
  const fnMatch = text.match(/\nFN:([^\n\r]+)/i) || text.match(/\nFN;[^:]*:([^\n\r]+)/i);
  const telMatch = text.match(/\nTEL[^:]*:([^\n\r]+)/i);
  const contactName = fnMatch?.[1]?.trim() || null;
  const contactPhone = telMatch?.[1]?.replace(/[^\d+]/g, '') || null;
  return { contactName, contactPhone };
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
          null;

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
        if (participantPhone && !participantName) {
          const keys = contactPhoneLookupKeys(participantPhone);
          const peer = await this.prisma.contact.findFirst({
            where: { phone: { in: keys } },
            select: { name: true, surname: true },
          });
          if (peer?.name || peer?.surname) {
            participantName = [peer.name, peer.surname].filter(Boolean).join(' ') || null;
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
      } else if (/@lid$/i.test(chatId)) {
        // ─────────────────────────────────────────────────────────────
        // LID → telefona çevir, başarısızsa atla
        // ─────────────────────────────────────────────────────────────
        const lidDigits = chatId.replace(/@lid$/i, '').replace(/\D/g, '');

        const pnJid = await this.wahaService.getLinkedPnFromLid(sessionName, chatId).catch(() => null);
        if (pnJid) {
          phone = extractPhoneFromIndividualJid(pnJid);
        }
        if (!phone) {
          const details = await this.wahaService.getContactDetails(sessionName, chatId).catch(() => null);
          const waNumber = details?.number ? String(details.number).replace(/\D/g, '') : '';
          if (waNumber && waNumber.length >= 7 && waNumber !== lidDigits) {
            phone = canonicalContactPhone(waNumber);
          }
        }
        if (phone && (phone === lidDigits || isLikelyLidPhone(phone))) {
          this.logger.debug(`Çözümlenen numara hala LID gibi görünüyor (${phone}), atlanıyor`);
          phone = null;
        }
        if (!phone || !isValidPhoneNumber(phone)) {
          this.logger.debug(`LID telefona çevrilemedi, atlanıyor: ${chatId}`);
          return;
        }

        const rawDisplayName =
          msg.pushName || msg._data?.notifyName || msg.notifyName || undefined;
        const displayName =
          rawDisplayName && !isFallbackContactName(rawDisplayName, phone) ? rawDisplayName : undefined;
        contact = await this.contactsService.findOrCreate(
          phone,
          displayName,
          waSession.organizationId,
        );

        if (displayName && isFallbackContactName(contact.name, contact.phone)) {
          try {
            contact = await this.prisma.contact.update({
              where: { id: contact.id },
              data: { name: displayName.trim() },
            });
          } catch {}
        }

        if (!contact.avatarUrl) {
          this.fetchAndSaveAvatar(sessionName, phone, contact.id).catch(() => {});
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

        const rawDisplayName =
          msg.pushName ||
          msg._data?.notifyName ||
          msg.notifyName ||
          undefined;
        const displayName =
          rawDisplayName && !isFallbackContactName(rawDisplayName, phone) ? rawDisplayName : undefined;

        contact = await this.contactsService.findOrCreate(
          phone,
          displayName,
          waSession.organizationId,
        );

        if (displayName && isFallbackContactName(contact.name, contact.phone)) {
          try {
            contact = await this.prisma.contact.update({
              where: { id: contact.id },
              data: { name: displayName.trim() },
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
      let mediaMeta: Record<string, any> | undefined;

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

        const wahaStoredUrl = msg.media?.url || msg.mediaUrl || msg._data?.mediaUrl;
        const waMessageIdCandidate =
          (typeof msg.id?._serialized === 'string' && msg.id._serialized) ||
          (typeof msg.id?.id === 'string' && msg.id.id) ||
          (typeof msg.id === 'string' && msg.id) ||
          '';
        const thumbnailBase64 =
          (typeof msg.media?.preview === 'string' && msg.media.preview) ||
          (typeof msg._data?.body === 'string' && msg._data.body.length > 40 ? msg._data.body : null) ||
          null;
        mediaMeta = {
          source: 'none',
          originalMediaUrl: null,
          thumbnailBase64,
          originalMimeType: mediaMimeType || null,
          originalFileSize: null,
          width: msg._data?.width || msg.media?.width || null,
          height: msg._data?.height || msg.media?.height || null,
        };

        // 1) Öncelik: WAHA'nın verdiği indirilebilir media URL (orijinal dosya varsayımı).
        if (wahaStoredUrl) {
          mediaUrl = await this.downloadAndSaveMedia(String(wahaStoredUrl), mediaMimeType);
          if (mediaUrl) {
            mediaMeta.source = 'waha_media_url';
            mediaMeta.originalMediaUrl = mediaUrl;
          }
        }

        // 2) İkinci öncelik: messageId ile dosyayı WAHA file endpointinden çek (thumbnail yerine orijinali yakalamak için).
        if (!mediaUrl && waMessageIdCandidate) {
          try {
            const byId = await this.wahaService.downloadFile(sessionName, waMessageIdCandidate);
            if (byId?.data?.length) {
              const dir = this.ensureUploadsDir();
              const ext = this.getExtFromMime(byId.mimetype || mediaMimeType);
              const filename = `${uuid()}${ext}`;
              const filePath = join(dir, filename);
              writeFileSync(filePath, byId.data);
              mediaUrl = `/uploads/${filename}`;
              mediaMimeType = byId.mimetype || mediaMimeType;
              mediaMeta.source = 'waha_file_by_message_id';
              mediaMeta.originalMediaUrl = mediaUrl;
              mediaMeta.originalMimeType = mediaMimeType || null;
              mediaMeta.originalFileSize = byId.data.length;
            }
          } catch (e: any) {
            this.logger.debug(`file-by-id media alınamadı (${waMessageIdCandidate}): ${e?.message}`);
          }
        }

        // 3) Son fallback: base64 alanı (çoğu zaman preview/thumbnail olabilir).
        if (!mediaUrl) {
          const base64Data = msg.media?.data || msg._data?.body;
          const looksB64 =
            typeof base64Data === 'string' &&
            base64Data.length > 80 &&
            /^[A-Za-z0-9+/=\s]+$/.test(base64Data.replace(/\s/g, ''));
          if (base64Data && looksB64) {
            mediaUrl = await this.saveBase64Media(
              base64Data.replace(/\s/g, ''),
              mediaMimeType,
            );
            if (mediaUrl) {
              mediaMeta.source = 'base64_fallback';
              mediaMeta.originalMediaUrl = mediaUrl;
            }
          }
        }

        this.logger.debug(
          `Media selected: type=${msg.type} source=${mediaMeta?.source} mime=${mediaMimeType} url=${mediaUrl} size=${mediaMeta?.originalFileSize ?? 'n/a'}`,
        );
      }

      // ─────────────────────────────────────────────────────────────
      // MESAJ KAYDI
      // ─────────────────────────────────────────────────────────────
      const rawId = msg.id?._serialized || msg.id?.id || msg.id;
      const waMessageId = typeof rawId === 'string' ? rawId : String(rawId ?? '');
      const direction = isFromMe ? MessageDirection.OUTGOING : MessageDirection.INCOMING;
      
      const isVcard = msg.type === 'vcard' || msg.type === 'multi_vcard' || /^BEGIN:VCARD/i.test(String(msg.body || ''));
      const vcardInfo = isVcard ? parseVcardPayload(msg.body || msg._data?.body || '') : null;
      const mergedMeta = {
        ...(mediaMeta || {}),
        ...(isVcard
          ? {
              kind: 'vcard',
              contactName: vcardInfo?.contactName || null,
              contactPhone: vcardInfo?.contactPhone || null,
            }
          : {}),
      };
      const bodyPreview = isVcard
        ? `👤 ${vcardInfo?.contactName || 'Kişi kartı'}${vcardInfo?.contactPhone ? ` (${vcardInfo.contactPhone})` : ''}`
        : (msg.body || (mediaType ? `📎 ${mediaType}` : ''));

      const messageData: any = {
        conversationId: conversation.id,
        sessionId: waSession.id,
        waMessageId,
        direction,
        body: bodyPreview,
        mediaUrl,
        mediaType: (mediaType || (isVcard ? 'DOCUMENT' : undefined)) as any,
        mediaMimeType,
        ...(Object.keys(mergedMeta).length ? { metadata: mergedMeta } : {}),
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
        update: {
          ...(isGroup
            ? {
                participantName:
                  messageData.participantName ||
                  undefined,
                participantPhone:
                  messageData.participantPhone ||
                  undefined,
              }
            : {}),
        },
        include: {
          sentBy: { select: { id: true, name: true } },
        },
      });

      // ─────────────────────────────────────────────────────────────
      // CONVERSATION GÜNCELLEME
      // ─────────────────────────────────────────────────────────────
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
