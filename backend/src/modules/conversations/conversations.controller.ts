import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Post,
  Delete,
  Body,
  UseGuards,
  Logger,
  Req,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  collectWhatsappMessageText,
  isWhatsappE2eOrSecuritySystemText,
} from '../../common/whatsapp-system-message';
import {
  assertConversationBelongsToOrg,
  whereWhatsappSessionsForOrg,
} from '../../common/org-session-scope';
import {
  canonicalContactPhone,
  contactPhoneLookupKeys,
  isLikelyLidPhone,
  isValidPhoneNumber,
  extractPhoneFromIndividualJid,
} from '../../common/contact-phone';
import { ConversationsService } from './conversations.service';
import { WahaService } from '../waha/waha.service';
import { ContactsService } from '../contacts/contacts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { MessageDirection, MessageStatus } from '@prisma/client';

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  constructor(
    private conversationsService: ConversationsService,
    private wahaService: WahaService,
    private contactsService: ContactsService,
    private prisma: PrismaService,
  ) {}

  @Get()
  findAll(
    @CurrentUser()
    user: {
      id: string;
      role: string;
      organizationId?: string | null;
    },
    @Query('sessionId') sessionId?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('archived') archived?: string,
    @Query('search') search?: string,
    @Query('filter') filter?: string,
    @Query('isGroup') isGroup?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const isAgent = user.role === 'AGENT';
    /** Temsilci özel filtreleri; yoksa varsayılan: atanmamış + bana atanan */
    const agentFilters = [
      'all',
      'mine_and_unassigned',
      'unanswered',
      'answered',
      'followup',
      'unassigned',
      'mine',
    ];
    const effectiveFilter = isAgent
      ? filter && agentFilters.includes(filter)
        ? filter
        : 'mine_and_unassigned'
      : filter;

    const pageNum = page ? parseInt(page, 10) : 1;
    const rawLimit = limit ? parseInt(limit, 10) : 500;
    const safeLimit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 2000)
        : 500;

    return this.conversationsService.findAll(user, {
      sessionId,
      assignedTo: isAgent ? user.id : assignedTo,
      isArchived: archived === 'true',
      search,
      filter: effectiveFilter,
      isGroup:
        typeof isGroup === 'string'
          ? isGroup === 'true'
            ? true
            : isGroup === 'false'
              ? false
              : undefined
          : undefined,
      page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
      limit: safeLimit,
    });
  }

  /** Teklif sayfası: kişiye göre son görüşme (gömülü chat) */
  @Get('for-contact/:contactId')
  async findForContact(@Param('contactId') contactId: string) {
    return this.conversationsService.findLatestByContactId(contactId);
  }

  @Get('history')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getHistory(
    @CurrentUser()
    user: { role: string; organizationId?: string | null },
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversationsService.getHistory(user, {
      search,
      from,
      to,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 100,
    });
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser()
    user: { role: string; organizationId?: string | null },
  ) {
    const conversation = await this.conversationsService.findById(id);
    assertConversationBelongsToOrg(conversation, user);
    return conversation;
  }

  @Get(':id/group-participants')
  async getGroupParticipants(
    @Param('id') id: string,
    @CurrentUser()
    user: { role: string; organizationId?: string | null },
  ) {
    const conversation = await this.conversationsService.findById(id, {
      skipContactEnrichment: true,
    });
    assertConversationBelongsToOrg(conversation, user);
    return this.conversationsService.getGroupParticipants(id);
  }

  @Patch(':id/read')
  async markAsRead(
    @Param('id') id: string,
    @CurrentUser()
    user: { role: string; organizationId?: string | null },
  ) {
    const conversation = await this.conversationsService.findById(id);
    assertConversationBelongsToOrg(conversation, user);
    return this.conversationsService.markAsRead(id);
  }

  @Patch(':id/archive')
  async archive(
    @Param('id') id: string,
    @CurrentUser()
    user: { role: string; organizationId?: string | null },
  ) {
    const conversation = await this.conversationsService.findById(id);
    assertConversationBelongsToOrg(conversation, user);
    return this.conversationsService.archive(id);
  }

  @Post(':id/assign')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async assign(
    @Param('id') id: string,
    @Body('userId') userId: string,
    @CurrentUser()
    user: { role: string; organizationId?: string | null },
  ) {
    const conversation = await this.conversationsService.findById(id);
    assertConversationBelongsToOrg(conversation, user);
    if (user.organizationId && user.role !== 'SUPERADMIN') {
      const targetUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { organizationId: true },
      });
      if (targetUser?.organizationId !== user.organizationId) {
        throw new ForbiddenException('Atanacak kullanıcı organizasyonunuza ait değil');
      }
    }
    return this.conversationsService.assign(id, userId);
  }

  @Get(':id/assignments')
  async getAssignments(
    @Param('id') id: string,
    @CurrentUser()
    user: { role: string; organizationId?: string | null },
  ) {
    const conversation = await this.conversationsService.findById(id, {
      skipContactEnrichment: true,
    });
    assertConversationBelongsToOrg(conversation, user);
    return this.conversationsService.getAssignmentHistory(id);
  }

  @Post(':id/auto-assign')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async autoAssign(
    @Param('id') id: string,
    @CurrentUser()
    user: { role: string; organizationId?: string | null },
  ) {
    const conversation = await this.conversationsService.findById(id);
    assertConversationBelongsToOrg(conversation, user);
    const orgId = user.role === 'SUPERADMIN' ? undefined : (user.organizationId ?? undefined);
    return this.conversationsService.autoAssignRoundRobin(id, orgId);
  }

  private static readonly SKIP_MSG_TYPES = new Set([
    'e2e_notification',
    'notification_template',
    'call_log',
    'gp2',
    'protocol',
    'revoked',
    'ciphertext',
    'notification',
    'groups_v4_invite',
    'security',
  ]);

  private isRealMessage(msg: any): boolean {
    if (!msg) return false;
    if (msg.isStatus) return false;
    if (ConversationsController.SKIP_MSG_TYPES.has(msg.type)) return false;
    if (msg._data?.type === 'e2e_notification') return false;

    const body = msg.body || '';
    if (body.match(/^\d{10,15}@[cgs]\.us$/)) return false;
    if (isWhatsappE2eOrSecuritySystemText(collectWhatsappMessageText(msg))) {
      return false;
    }

    return true;
  }

  private getExtFromFilename(filename?: string): string {
    if (!filename) return '';
    const match = filename.match(/\.(\w+)$/);
    return match ? `.${match[1].toLowerCase()}` : '';
  }

  private getExtFromMime(mimetype?: string): string {
    if (!mimetype) return '';
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'audio/ogg': '.ogg',
      'audio/mpeg': '.mp3',
      'application/pdf': '.pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    };
    return map[mimetype] || '';
  }

  private getMediaType(msg: any): { mediaType?: string; mediaMimeType?: string } {
    const hasMedia = msg.hasMedia || msg._data?.mimetype;
    if (!hasMedia) return {};

    const mediaMimeType = msg.mimetype || msg._data?.mimetype;
    const lowerMime = String(mediaMimeType || '').toLowerCase();
    const typeHints = [
      msg.type,
      msg._data?.type,
      msg.media?.type,
      msg._data?.mediaType,
    ]
      .map((v) => String(v || '').toLowerCase())
      .filter(Boolean);
    const fileLike = [
      msg.body,
      msg._data?.filename,
      msg.media?.filename,
      msg.mediaUrl,
      msg._data?.mediaUrl,
      mediaMimeType,
    ]
      .map((v) => String(v || '').toLowerCase())
      .join(' ');
    let mediaType: string | undefined;

    if (lowerMime.startsWith('image/') || typeHints.some((t) => t.includes('image') || t.includes('sticker'))) mediaType = 'IMAGE';
    else if (lowerMime.startsWith('video/') || typeHints.some((t) => t.includes('video'))) mediaType = 'VIDEO';
    else if (lowerMime.startsWith('audio/') || typeHints.some((t) => t.includes('audio') || t.includes('ptt') || t.includes('voice'))) mediaType = 'AUDIO';
    else if (/\.(jpe?g|png|gif|webp|bmp|heic|heif)\b/.test(fileLike)) mediaType = 'IMAGE';
    else if (/\.(mp4|mov|m4v|webm|3gp)\b/.test(fileLike)) mediaType = 'VIDEO';
    else if (/\.(ogg|opus|mp3|m4a|aac|wav)\b/.test(fileLike)) mediaType = 'AUDIO';
    else mediaType = 'DOCUMENT';

    return { mediaType, mediaMimeType };
  }

  @Post(':id/sync')
  async syncMessages(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string; organizationId?: string | null },
  ) {
    const conversation = await this.conversationsService.findById(id, {
      skipContactEnrichment: true,
    });
    assertConversationBelongsToOrg(conversation, user);
    const result = await this.syncMessagesCore(id);

    await this.conversationsService
      .enrichConversationContactFromWaha(result.conversationId || id)
      .catch(() => {});

    return result;
  }

  /** WAHA’dan mesaj çekme (iç kullanım; org kontrolü çağıran yapar) */
  async syncMessagesCore(
    id: string,
    opts?: { downloadMedia?: boolean },
  ): Promise<{ synced: number; message: string; conversationId: string }> {
    let conversation = await this.conversationsService.findById(id, {
      skipContactEnrichment: true,
    });
    let rawPhone = conversation.contact.phone;
    const sessionName = conversation.session.name;
    const isGroupConversation = !!conversation.isGroup;

    if (!isGroupConversation && isLikelyLidPhone(rawPhone)) {
      const resolved = await this.tryResolveLidPhone(
        conversation.contact.id,
        rawPhone,
        sessionName,
        conversation.session.id,
      );
      if (!resolved) {
        return { synced: 0, message: 'LID numara çözümlenemedi', conversationId: id };
      }
      rawPhone = resolved;

      // Kalıcılaştır: çözülmüş telefon başka bir kişide varsa bu konuşmayı ona bağla.
      // Böylece frontend bir sonraki fetch'te doğrudan gerçek numarayı görür.
      const resolvedContact = await this.prisma.contact.findFirst({
        where: { phone: resolved },
        select: { id: true },
      });
      if (resolvedContact && resolvedContact.id !== conversation.contact.id) {
        try {
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { contactId: resolvedContact.id },
          });
          const refreshed = await this.conversationsService.findById(conversation.id, {
            skipContactEnrichment: true,
          });
          conversation = refreshed;
          this.logger.log(
            `Konuşma kişi bağı güncellendi: conv=${conversation.id}, contact=${resolvedContact.id}`,
          );
        } catch (e: any) {
          const targetConversation = await this.prisma.conversation.findFirst({
            where: {
              contactId: resolvedContact.id,
              sessionId: conversation.session.id,
            },
            select: { id: true },
          });
          if (targetConversation && targetConversation.id !== conversation.id) {
            // contactId+sessionId unique çakışmasında konuşmaları birleştir.
            await this.prisma.$transaction(async (tx) => {
              await tx.message.updateMany({
                where: { conversationId: conversation.id },
                data: { conversationId: targetConversation.id },
              });
              await tx.assignment.updateMany({
                where: { conversationId: conversation.id },
                data: { conversationId: targetConversation.id },
              });
              await tx.internalNote.updateMany({
                where: { conversationId: conversation.id },
                data: { conversationId: targetConversation.id },
              });
              await tx.conversation.update({
                where: { id: targetConversation.id },
                data: {
                  lastMessageAt: conversation.lastMessageAt,
                  lastMessageText: conversation.lastMessageText || undefined,
                  unreadCount: { increment: conversation.unreadCount || 0 },
                },
              });
              await tx.conversation.delete({ where: { id: conversation.id } });
            });
            const refreshed = await this.conversationsService.findById(targetConversation.id, {
              skipContactEnrichment: true,
            });
            conversation = refreshed;
            this.logger.log(
              `Konuşmalar birleştirildi: source=${id}, target=${targetConversation.id}`,
            );
          } else {
            this.logger.debug(
              `Konuşma kişi bağı güncellenemedi (${conversation.id}): ${e?.message}`,
            );
          }
        }
      }
    }

    const effectiveConversationId = conversation.id;
    let chatIdForWaha = '';
    if (isGroupConversation) {
      const groupJid = String(conversation.waGroupId || '').trim();
      if (!groupJid || !groupJid.endsWith('@g.us')) {
        return {
          synced: 0,
          message: 'Geçersiz grup kimliği',
          conversationId: effectiveConversationId,
        };
      }
      chatIdForWaha = groupJid;
    } else {
      const waDigits =
        this.contactsService.digitsForWahaProfile(rawPhone) ||
        canonicalContactPhone(rawPhone) ||
        '';
      if (!waDigits || !/^\d{10,15}$/.test(waDigits)) {
        return { synced: 0, message: 'Geçersiz telefon veya kimlik', conversationId: effectiveConversationId };
      }
      chatIdForWaha = `${waDigits}@c.us`;
    }

    const downloadMedia = opts?.downloadMedia !== false;
    const wahaMessages = await this.wahaService.getChatMessages(
      sessionName,
      chatIdForWaha,
      undefined,
      downloadMedia,
    );

    if (!wahaMessages.length) {
      return { synced: 0, message: 'WAHA\'dan mesaj bulunamadı', conversationId: effectiveConversationId };
    }

    const existingIds = new Set(
      (
        await this.prisma.message.findMany({
          where: { conversationId: effectiveConversationId, waMessageId: { not: null } },
          select: { waMessageId: true },
        })
      )
        .map((m) => m.waMessageId)
        .filter(Boolean),
    );

    const messagesToCreate: any[] = [];

    for (const msg of wahaMessages) {
      const waMessageId = msg.id?._serialized || msg.id;
      if (!waMessageId || existingIds.has(waMessageId)) continue;
      if (!this.isRealMessage(msg)) continue;

      const direction = msg.fromMe
        ? MessageDirection.OUTGOING
        : MessageDirection.INCOMING;
      const rawParticipantJid = String(
        msg.author ||
          msg.participant ||
          msg._data?.author ||
          msg._data?.participant ||
          '',
      ).trim();
      const participantPhone = rawParticipantJid
        ? (extractPhoneFromIndividualJid(rawParticipantJid) || null)
        : null;
      const participantName = String(
        msg.pushName ||
          msg._data?.notifyName ||
          msg._data?.pushName ||
          '',
      ).trim() || null;

      let body = msg.body || '';
      let metadata: Record<string, any> | undefined;
      const { mediaType, mediaMimeType } = this.getMediaType(msg);

      if (msg.type === 'location' || msg.type === 'live_location') {
        body = body || `📍 Konum: ${msg.lat || ''}, ${msg.lng || ''}`;
      } else if (msg.type === 'vcard' || msg.type === 'multi_vcard' || /^BEGIN:VCARD/i.test(String(msg.body || ''))) {
        const vcardRaw = String(msg.body || msg._data?.body || '');
        const fnMatch = vcardRaw.match(/\nFN:([^\n\r]+)/i) || vcardRaw.match(/\nFN;[^:]*:([^\n\r]+)/i);
        const telMatch = vcardRaw.match(/\nTEL[^:]*:([^\n\r]+)/i);
        const cName = fnMatch?.[1]?.trim() || null;
        const cPhone = telMatch?.[1]?.replace(/[^\d+]/g, '') || null;
        body = `👤 ${cName || 'Kişi kartı'}${cPhone ? ` (${cPhone})` : ''}`;
        metadata = {
          ...(metadata || {}),
          kind: 'vcard',
          contactName: cName,
          contactPhone: cPhone,
        };
      } else if (msg.type === 'order' || msg.type === 'product') {
        body = body || '🛒 Sipariş/Ürün';
      }

      if (!body && !mediaType) continue;

      let mediaUrl: string | undefined;
      if (mediaType) {
        const ext = this.getExtFromFilename(body) || this.getExtFromMime(mediaMimeType);
        mediaUrl = `/api/files/${sessionName}/${waMessageId}${ext}`;
        metadata = {
          ...(metadata || {}),
          source: 'sync_file_proxy',
          originalMediaUrl: mediaUrl,
          thumbnailBase64:
            (typeof msg?.media?.preview === 'string' && msg.media.preview) ||
            (typeof msg?._data?.body === 'string' && msg._data.body.length > 40 ? msg._data.body : null) ||
            null,
          originalMimeType: mediaMimeType || null,
          originalFileSize: null,
          width: msg?._data?.width || msg?.media?.width || null,
          height: msg?._data?.height || msg?.media?.height || null,
        };
      }

      let reactions: any[] | undefined;
      if (msg.reactions?.length) {
        reactions = msg.reactions.map((r: any) => ({
          emoji: r.text || r.emoji || '',
          sender: r.from || r.senderId || '',
          senderName: r.senderName || '',
          timestamp: r.timestamp ? r.timestamp * 1000 : Date.now(),
        }));
      }

      messagesToCreate.push({
        conversationId: effectiveConversationId,
        sessionId: conversation.session.id,
        waMessageId,
        direction,
        body,
        mediaUrl,
        mediaType: mediaType as any,
        mediaMimeType,
        ...(metadata ? { metadata } : {}),
        ...(reactions?.length ? { reactions } : {}),
        ...(isGroupConversation
          ? {
              participantName: direction === MessageDirection.OUTGOING
                ? (participantName || 'Siz')
                : participantName,
              participantPhone: direction === MessageDirection.INCOMING
                ? participantPhone
                : undefined,
            }
          : {}),
        status:
          direction === MessageDirection.OUTGOING
            ? MessageStatus.SENT
            : MessageStatus.DELIVERED,
        timestamp: new Date((msg.timestamp || 0) * 1000),
      });
    }

    let synced = 0;
    if (messagesToCreate.length > 0) {
      const result = await this.prisma.message.createMany({
        data: messagesToCreate,
        skipDuplicates: true,
      });
      synced = result.count;
    }

    const realMessages = wahaMessages
      .filter((m) => this.isRealMessage(m) && m.timestamp)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const lastReal = realMessages[0];
    if (lastReal) {
      const preview = lastReal.body || (lastReal.hasMedia ? '📎 Medya' : '');
      await this.prisma.conversation.update({
        where: { id: effectiveConversationId },
        data: {
          lastMessageText: preview,
          lastMessageAt: new Date((lastReal.timestamp || 0) * 1000),
        },
      });
    }

    if (synced > 0) {
      this.logger.log(`${synced} mesaj senkronize edildi (${chatIdForWaha})`);
    }
    return {
      synced,
      message: `${synced} mesaj senkronize edildi`,
      conversationId: effectiveConversationId,
    };
  }

  @Post('sync-phone/:phone')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async syncPhone(@Req() req: any, @Param('phone') phone: string) {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 6) {
      return { synced: 0, message: 'Geçersiz telefon numarası' };
    }
    const phoneKeys = contactPhoneLookupKeys(cleanPhone);

    const u = req.user as {
      role?: string;
      organizationId?: string | null;
    };
    const sessions = await this.prisma.whatsappSession.findMany({
      where: whereWhatsappSessionsForOrg(u, { status: 'WORKING' }),
      orderBy: { updatedAt: 'desc' },
    });

    if (!sessions.length) {
      return { synced: 0, message: 'Aktif oturum bulunamadı' };
    }

    const contactRow = await this.prisma.contact.findFirst({
      where: { phone: { in: phoneKeys } },
      select: { id: true },
    });
    let session = sessions[0];
    if (contactRow) {
      const conv = await this.prisma.conversation.findFirst({
        where: {
          contactId: contactRow.id,
          sessionId: { in: sessions.map((s) => s.id) },
        },
        select: { sessionId: true },
      });
      if (conv) {
        const preferred = sessions.find((s) => s.id === conv.sessionId);
        if (preferred) session = preferred;
      }
    }
    const contact = await this.contactsService.findOrCreate(cleanPhone, cleanPhone, session.organizationId);
    const conversation = await this.conversationsService.findOrCreate(
      contact.id,
      session.id,
    );

    const result = await this.syncMessagesCore(conversation.id);
    this.logger.log(`Telefon sync: ${cleanPhone} -> ${result.synced} mesaj`);
    return result;
  }

  private async tryResolveLidPhone(
    contactId: string,
    lidPhone: string,
    sessionName: string,
    sessionId?: string,
  ): Promise<string | null> {
    const lidDigits = String(lidPhone).replace(/\D/g, '');
    if (!lidDigits) return null;
    try {
      const lidJid = `${lidDigits}@lid`;
      const pnJid = await this.wahaService.getLinkedPnFromLid(sessionName, lidJid).catch(() => null);
      let realPhone: string | null = null;
      if (pnJid) {
        realPhone = extractPhoneFromIndividualJid(pnJid);
      }
      if (!realPhone) {
        const details = await this.wahaService.getContactDetails(sessionName, lidJid).catch(() => null);
        const waNumber = details?.number ? String(details.number).replace(/\D/g, '') : '';
        if (waNumber && waNumber !== lidDigits && !isLikelyLidPhone(waNumber)) {
          realPhone = canonicalContactPhone(waNumber);
        }
      }
      if (realPhone && isValidPhoneNumber(realPhone) && !isLikelyLidPhone(realPhone)) {
        try {
          await this.prisma.contact.update({
            where: { id: contactId },
            data: { phone: realPhone },
          });
        } catch (e: any) {
          // Unique çakışma olabilir; bu durumda gerçek telefon zaten başka bir contact'ta kayıtlıdır.
          const existing = await this.prisma.contact.findFirst({
            where: { phone: realPhone },
            select: { id: true },
          });
          if (!existing) throw e;
        }
        this.logger.log(`LID telefon çözümlendi: ${lidDigits} → ${realPhone}`);
        if (sessionId) {
          await this.mergeLidConversationsIntoResolvedContact(
            contactId,
            realPhone,
            sessionId,
          );
        }
        return realPhone;
      }
    } catch (e: any) {
      this.logger.debug(`LID çözümleme hatası (${lidDigits}): ${e?.message}`);
    }
    return null;
  }

  private async mergeLidConversationsIntoResolvedContact(
    sourceContactId: string,
    resolvedPhone: string,
    sessionId: string,
  ): Promise<void> {
    const targetContact = await this.prisma.contact.findFirst({
      where: { phone: resolvedPhone },
      select: { id: true },
    });
    if (!targetContact || targetContact.id === sourceContactId) return;

    const sourceConversations = await this.prisma.conversation.findMany({
      where: { contactId: sourceContactId, sessionId, isGroup: false },
      select: { id: true, lastMessageAt: true, lastMessageText: true, unreadCount: true },
    });

    for (const sourceConv of sourceConversations) {
      const targetConv = await this.prisma.conversation.findFirst({
        where: { contactId: targetContact.id, sessionId, isGroup: false },
        select: { id: true },
      });
      if (!targetConv) {
        await this.prisma.conversation
          .update({
            where: { id: sourceConv.id },
            data: { contactId: targetContact.id },
          })
          .catch(() => {});
        continue;
      }
      if (targetConv.id === sourceConv.id) continue;

      await this.prisma.$transaction(async (tx) => {
        await tx.message.updateMany({
          where: { conversationId: sourceConv.id },
          data: { conversationId: targetConv.id },
        });
        await tx.assignment.updateMany({
          where: { conversationId: sourceConv.id },
          data: { conversationId: targetConv.id },
        });
        await tx.internalNote.updateMany({
          where: { conversationId: sourceConv.id },
          data: { conversationId: targetConv.id },
        });
        await tx.conversation.update({
          where: { id: targetConv.id },
          data: {
            lastMessageAt: sourceConv.lastMessageAt,
            lastMessageText: sourceConv.lastMessageText || undefined,
            unreadCount: { increment: sourceConv.unreadCount || 0 },
          },
        });
        await tx.conversation.delete({ where: { id: sourceConv.id } });
      });
      this.logger.log(`LID konuşma birleştirildi: source=${sourceConv.id}, target=${targetConv.id}`);
    }
  }

  private async processInBatches<T>(
    items: T[],
    batchSize: number,
    fn: (item: T) => Promise<void>,
  ) {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(fn));
    }
  }

  @Post('sync-all')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async syncAllConversations(@Req() req: any) {
    const u = req.user as {
      role?: string;
      organizationId?: string | null;
    };
    const sessions = await this.prisma.whatsappSession.findMany({
      where: whereWhatsappSessionsForOrg(u, { status: 'WORKING' }),
      orderBy: { updatedAt: 'desc' },
    });

    let totalSynced = 0;
    let updatedConversations = 0;
    let skippedConversations = 0;
    let lidResolved = 0;

    for (const session of sessions) {
      try {
        const lidContacts = await this.prisma.contact.findMany({
          where: {
            conversations: { some: { sessionId: session.id } },
            NOT: [
              { phone: { startsWith: 'group:' } },
              { phone: { startsWith: 'lid:' } },
            ],
          },
          select: { id: true, phone: true },
        });
        const actualLidContacts = lidContacts.filter(c => isLikelyLidPhone(c.phone));
        if (actualLidContacts.length > 0) {
          this.logger.log(`${actualLidContacts.length} LID telefonlu kişi bulundu, çözümleniyor...`);
          await this.processInBatches(actualLidContacts, 3, async (c) => {
            const resolved = await this.tryResolveLidPhone(c.id, c.phone, session.name, session.id);
            if (resolved) lidResolved++;
          });
          this.logger.log(`${lidResolved} LID telefon gerçek numaraya çevrildi`);
        }

        const chats = await this.wahaService.getChats(session.name);
        this.logger.log(
          `WAHA'dan ${chats.length} chat alındı (${session.name})`,
        );

        const personalChats = chats.filter((chat) => {
          const cid = chat.id?._serialized || chat.id;
          if (!cid) return false;
          if (!cid.endsWith('@c.us') && !cid.endsWith('@g.us')) return false;
          if (cid === 'status@broadcast') return false;
          if (cid.includes('@broadcast')) return false;
          return true;
        });

        this.logger.log(`${personalChats.length} kişisel chat filtrelendi`);

        const dbConversations = await this.prisma.conversation.findMany({
          where: { sessionId: session.id },
          select: {
            id: true,
            lastMessageAt: true,
            contact: { select: { phone: true } },
          },
        });
        const dbConvMap = new Map(
          dbConversations.map((c) => [
            canonicalContactPhone(c.contact.phone) || c.contact.phone,
            c,
          ]),
        );

        type SyncTask = {
          conversationId: string;
          contactId: string;
          hasAvatar: boolean;
          phone: string;
          preview: string | null;
          wahaTs: Date | null;
        };
        const syncTasks: SyncTask[] = [];

        for (const chat of personalChats) {
          const chatId = chat.id?._serialized || chat.id;
          const isGroupChat = chatId.endsWith('@g.us');
          const phoneRaw = isGroupChat ? '' : chatId.replace('@c.us', '');
          const phone = isGroupChat ? '' : (canonicalContactPhone(phoneRaw) || phoneRaw);
          if (!isGroupChat && (!phoneRaw || phoneRaw.length < 6)) continue;

          const contactName = chat.pushname || chat.name || chat.subject || phone || 'WhatsApp Grubu';
          const wahaTs = chat.timestamp
            ? new Date(chat.timestamp * 1000)
            : null;

          const existing = isGroupChat ? null : dbConvMap.get(phone);
          if (existing && this.wahaService.syncSkipUpToDateConversations) {
            const dbTs = existing.lastMessageAt
              ? Math.floor(existing.lastMessageAt.getTime() / 1000)
              : 0;
            const waTs = wahaTs
              ? Math.floor(wahaTs.getTime() / 1000)
              : 0;
            if (waTs > 0 && dbTs > 0 && dbTs > waTs) {
              skippedConversations++;
              continue;
            }
          }

          let conversation: any;
          let contact: any;
          if (isGroupChat) {
            contact = await this.contactsService.findOrCreateForGroup(
              chatId,
              contactName,
              session.organizationId,
            );
            conversation = await this.conversationsService.findOrCreateGroup(
              contact.id,
              session.id,
              chatId,
              contactName,
            );
          } else {
            contact = await this.contactsService.findOrCreate(
              phoneRaw,
              contactName,
              session.organizationId,
            );
            conversation = await this.conversationsService.findOrCreate(
              contact.id,
              session.id,
            );
          }

          let preview: string | null = null;
          const lastMsg = chat.lastMessage;
          if (lastMsg && this.isRealMessage(lastMsg)) {
            preview = lastMsg.body || (lastMsg.hasMedia ? '📎 Medya' : null);
          }

          syncTasks.push({
            conversationId: conversation.id,
            contactId: contact.id,
            hasAvatar: !!contact.avatarUrl,
            phone: isGroupChat ? chatId : phone,
            preview,
            wahaTs,
          });
        }

        this.logger.log(
          `${syncTasks.length} konuşma senkronize edilecek, ${skippedConversations} atlandı (güncel)`,
        );

        await this.processInBatches(syncTasks, 5, async (task) => {
          try {
            if (task.wahaTs) {
              await this.prisma.conversation.update({
                where: { id: task.conversationId },
                data: {
                  lastMessageAt: task.wahaTs,
                  ...(task.preview ? { lastMessageText: task.preview } : {}),
                },
              });
            }

            const result = await this.syncMessagesCore(task.conversationId, {
              downloadMedia: false,
            });
            totalSynced += result.synced;
            if (result.synced > 0) updatedConversations++;
            await this.conversationsService
              .enrichConversationContactFromWaha(result.conversationId || task.conversationId)
              .catch(() => {});

            if (!task.hasAvatar && !String(task.phone || '').endsWith('@g.us')) {
              try {
                const waDigits =
                  this.contactsService.digitsForWahaProfile(task.phone) ||
                  canonicalContactPhone(task.phone) ||
                  '';
                const picUrl = waDigits
                  ? await this.wahaService.getProfilePicture(
                      session.name,
                      waDigits,
                    )
                  : null;
                if (picUrl) {
                  await this.contactsService.fetchAndSaveProfilePicture(
                    task.contactId,
                    waDigits,
                    picUrl,
                  );
                }
              } catch {}
            }
          } catch (err: any) {
            this.logger.warn(
              `Senkronizasyon hatası (${task.phone}): ${err.message}`,
            );
          }
        });
      } catch (err: any) {
        this.logger.error(
          `Oturum senkronizasyonu hatası (${session.name}): ${err.message}`,
        );
      }
    }

    this.logger.log(
      `Tam senkronizasyon: ${totalSynced} mesaj, ${updatedConversations} güncellenen, ${skippedConversations} atlanan konuşma, ${lidResolved} LID çözümlendi`,
    );

    return {
      totalSynced,
      updatedConversations,
      skippedConversations,
      lidResolved,
      message: `${totalSynced} mesaj senkronize edildi, ${updatedConversations} konuşma güncellendi, ${skippedConversations} atlandı, ${lidResolved} LID çözümlendi`,
    };
  }

  @Post(':id/notes')
  async addNote(
    @Param('id') id: string,
    @Body('body') body: string,
    @CurrentUser()
    user: {
      id: string;
      role: string;
      organizationId?: string | null;
    },
  ) {
    const conversation = await this.conversationsService.findById(id);
    assertConversationBelongsToOrg(conversation, user);
    return this.conversationsService.addInternalNote(id, user.id, body);
  }

  @Get(':id/notes')
  async getNotes(
    @Param('id') id: string,
    @CurrentUser()
    user: { role: string; organizationId?: string | null },
  ) {
    const conversation = await this.conversationsService.findById(id);
    assertConversationBelongsToOrg(conversation, user);
    return this.conversationsService.getInternalNotes(id);
  }

  @Patch(':id/notes/:noteId')
  async updateNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body('body') body: string,
    @CurrentUser()
    user: { id: string; role: string; organizationId?: string | null },
  ) {
    const conversation = await this.conversationsService.findById(id);
    assertConversationBelongsToOrg(conversation, user);
    const note = await this.prisma.internalNote.findUnique({
      where: { id: noteId },
      select: { id: true, conversationId: true, userId: true },
    });
    if (!note || note.conversationId !== id) throw new NotFoundException('Not bulunamadı');
    const canManage =
      note.userId === user.id || user.role === 'ADMIN' || user.role === 'SUPERADMIN';
    if (!canManage) throw new ForbiddenException('Bu notu düzenleme yetkiniz yok');
    return this.conversationsService.updateInternalNote(noteId, String(body || ''));
  }

  @Delete(':id/notes/:noteId')
  async deleteNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @CurrentUser()
    user: { id: string; role: string; organizationId?: string | null },
  ) {
    const conversation = await this.conversationsService.findById(id);
    assertConversationBelongsToOrg(conversation, user);
    const note = await this.prisma.internalNote.findUnique({
      where: { id: noteId },
      select: { id: true, conversationId: true, userId: true },
    });
    if (!note || note.conversationId !== id) throw new NotFoundException('Not bulunamadı');
    const canManage =
      note.userId === user.id || user.role === 'ADMIN' || user.role === 'SUPERADMIN';
    if (!canManage) throw new ForbiddenException('Bu notu silme yetkiniz yok');
    await this.conversationsService.deleteInternalNote(noteId);
    return { deleted: true };
  }
}
