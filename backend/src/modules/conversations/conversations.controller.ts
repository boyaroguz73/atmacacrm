import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Post,
  Body,
  UseGuards,
  Logger,
  Req,
  ForbiddenException,
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
      page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
      limit: safeLimit,
    });
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
    let mediaType: string | undefined;

    if (mediaMimeType?.startsWith('image/')) mediaType = 'IMAGE';
    else if (mediaMimeType?.startsWith('video/')) mediaType = 'VIDEO';
    else if (mediaMimeType?.startsWith('audio/')) mediaType = 'AUDIO';
    else if (msg.type === 'image' || msg.type === 'sticker') mediaType = 'IMAGE';
    else if (msg.type === 'video') mediaType = 'VIDEO';
    else if (msg.type === 'audio' || msg.type === 'ptt') mediaType = 'AUDIO';
    else mediaType = 'DOCUMENT';

    return { mediaType, mediaMimeType };
  }

  @Post(':id/sync')
  async syncMessages(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string; organizationId?: string | null },
  ) {
    const conversation = await this.conversationsService.findById(id);
    assertConversationBelongsToOrg(conversation, user);
    const result = await this.syncMessagesCore(id);

    if (!conversation.contact.avatarUrl) {
      try {
        const picUrl = await this.wahaService.getProfilePicture(
          conversation.session.name,
          conversation.contact.phone,
        );
        if (picUrl) {
          await this.contactsService.fetchAndSaveProfilePicture(
            conversation.contact.id,
            conversation.contact.phone,
            picUrl,
          );
        }
      } catch {}
    }

    return result;
  }

  /** WAHA’dan mesaj çekme (iç kullanım; org kontrolü çağıran yapar) */
  async syncMessagesCore(
    id: string,
  ): Promise<{ synced: number; message: string }> {
    const conversation = await this.conversationsService.findById(id);
    const phone = canonicalContactPhone(conversation.contact.phone) || conversation.contact.phone;
    const sessionName = conversation.session.name;
    const chatId = `${phone}@c.us`;

    const wahaMessages = await this.wahaService.getChatMessages(
      sessionName,
      chatId,
    );

    if (!wahaMessages.length) {
      return { synced: 0, message: 'WAHA\'dan mesaj bulunamadı' };
    }

    const existingIds = new Set(
      (
        await this.prisma.message.findMany({
          where: { conversationId: id, waMessageId: { not: null } },
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

      let body = msg.body || '';
      const { mediaType, mediaMimeType } = this.getMediaType(msg);

      if (msg.type === 'location' || msg.type === 'live_location') {
        body = body || `📍 Konum: ${msg.lat || ''}, ${msg.lng || ''}`;
      } else if (msg.type === 'vcard' || msg.type === 'multi_vcard') {
        body = body || '👤 Kişi kartı';
      } else if (msg.type === 'order' || msg.type === 'product') {
        body = body || '🛒 Sipariş/Ürün';
      }

      if (!body && !mediaType) continue;

      let mediaUrl: string | undefined;
      if (mediaType) {
        const ext = this.getExtFromFilename(body) || this.getExtFromMime(mediaMimeType);
        mediaUrl = `/api/files/${sessionName}/${waMessageId}${ext}`;
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
        conversationId: id,
        sessionId: conversation.session.id,
        waMessageId,
        direction,
        body,
        mediaUrl,
        mediaType: mediaType as any,
        mediaMimeType,
        ...(reactions?.length ? { reactions } : {}),
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
        where: { id },
        data: {
          lastMessageText: preview,
          lastMessageAt: new Date((lastReal.timestamp || 0) * 1000),
        },
      });
    }

    if (synced > 0) {
      this.logger.log(`${synced} mesaj senkronize edildi (${phone})`);
    }
    return { synced, message: `${synced} mesaj senkronize edildi` };
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

    for (const session of sessions) {
      try {
        const chats = await this.wahaService.getChats(session.name);
        this.logger.log(
          `WAHA'dan ${chats.length} chat alındı (${session.name})`,
        );

        const personalChats = chats.filter((chat) => {
          const cid = chat.id?._serialized || chat.id;
          if (!cid) return false;
          if (!cid.endsWith('@c.us')) return false;
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
          const phoneRaw = chatId.replace('@c.us', '');
          if (!phoneRaw || phoneRaw.length < 6) continue;
          const phone = canonicalContactPhone(phoneRaw) || phoneRaw;

          const contactName = chat.name || chat.pushname || phone;
          const wahaTs = chat.timestamp
            ? new Date(chat.timestamp * 1000)
            : null;

          const existing = dbConvMap.get(phone);
          if (existing) {
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

          const contact = await this.contactsService.findOrCreate(
            phoneRaw,
            contactName,
            session.organizationId,
          );
          const conversation = await this.conversationsService.findOrCreate(
            contact.id,
            session.id,
          );

          let preview: string | null = null;
          const lastMsg = chat.lastMessage;
          if (lastMsg && this.isRealMessage(lastMsg)) {
            preview = lastMsg.body || (lastMsg.hasMedia ? '📎 Medya' : null);
          }

          syncTasks.push({
            conversationId: conversation.id,
            contactId: contact.id,
            hasAvatar: !!contact.avatarUrl,
            phone,
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

            const result = await this.syncMessagesCore(task.conversationId);
            totalSynced += result.synced;
            if (result.synced > 0) updatedConversations++;

            if (!task.hasAvatar) {
              try {
                const picUrl = await this.wahaService.getProfilePicture(session.name, task.phone);
                if (picUrl) {
                  await this.contactsService.fetchAndSaveProfilePicture(task.contactId, task.phone, picUrl);
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
      `Tam senkronizasyon: ${totalSynced} mesaj, ${updatedConversations} güncellenen, ${skippedConversations} atlanan konuşma`,
    );

    return {
      totalSynced,
      updatedConversations,
      skippedConversations,
      message: `${totalSynced} mesaj senkronize edildi, ${updatedConversations} konuşma güncellendi, ${skippedConversations} atlandı`,
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
}
