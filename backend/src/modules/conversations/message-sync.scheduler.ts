import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WahaService } from '../waha/waha.service';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import {
  canonicalContactPhone,
  contactPhoneLookupKeys,
  isFallbackContactName,
} from '../../common/contact-phone';

@Injectable()
export class MessageSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(MessageSyncScheduler.name);
  private controller: ConversationsController;
  private isSyncing = false;

  constructor(
    private prisma: PrismaService,
    private wahaService: WahaService,
    private contactsService: ContactsService,
    private conversationsService: ConversationsService,
  ) {
    this.controller = new ConversationsController(
      conversationsService,
      wahaService,
      contactsService,
      prisma,
    );
  }

  async onModuleInit() {
    setTimeout(() => this.runStartupSync(), 15_000);
  }

  @Cron('0 */5 * * * *')
  async scheduledSync() {
    if (this.isSyncing) {
      this.logger.warn('Önceki senkron hâlâ çalışıyor, bu tur atlandı.');
      return;
    }
    this.isSyncing = true;
    try {
      this.logger.log('Periyodik mesaj senkronu başlıyor...');
      await this.wahaService.ensureWebhooksRegistered();
      await this.syncAllSessions();
    } finally {
      this.isSyncing = false;
    }
  }

  private async runStartupSync() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      this.logger.log('Başlangıç mesaj senkronu başlıyor...');
      await this.syncAllSessions();
    } finally {
      this.isSyncing = false;
    }
  }

  private async syncAllSessions() {
    try {
      const sessions = await this.prisma.whatsappSession.findMany({
        where: { status: 'WORKING' },
        orderBy: { updatedAt: 'desc' },
      });

      if (!sessions.length) {
        this.logger.debug('Aktif oturum yok, senkron atlanıyor');
        return;
      }

      let totalSynced = 0;
      let totalConversations = 0;
      let failedChats = 0;
      let dbFirst = 0;

      for (const session of sessions) {
        try {
          const chats = await this.wahaService.getChats(session.name);
          if (!chats.length) {
            this.logger.warn(`Oturum ${session.name}: WAHA'dan sohbet alınamadı (boş yanıt)`);
            continue;
          }

          const personalChats = chats.filter((chat: any) => {
            const cid = chat.id?._serialized || chat.id;
            return cid && cid.endsWith('@c.us') && cid !== 'status@broadcast' && !cid.includes('@broadcast');
          });

          const sortedChats = personalChats
            .filter((c: any) => c.timestamp)
            .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));

          // ─── DB-FIRST: Tüm telefon numaraları için DB'yi tek sorguda yükle ───
          const allLookupKeys = sortedChats.flatMap((chat: any) => {
            const chatId = chat.id?._serialized || chat.id;
            const rawPhone = chatId.replace('@c.us', '');
            return contactPhoneLookupKeys(rawPhone);
          }).filter(Boolean);

          const existingContacts = await this.prisma.contact.findMany({
            where: {
              phone: { in: allLookupKeys },
              ...(session.organizationId ? { organizationId: session.organizationId } : {}),
            },
            select: {
              id: true,
              phone: true,
              name: true,
              avatarUrl: true,
              conversations: {
                where: { sessionId: session.id },
                select: { id: true },
              },
            },
          });

          // Mesaj sayılarını tek sorguda al
          const existingConvIds = existingContacts.flatMap(c => c.conversations.map(cv => cv.id));
          const msgCountData = existingConvIds.length
            ? await this.prisma.message.groupBy({
                by: ['conversationId'],
                where: { conversationId: { in: existingConvIds } },
                _count: { id: true },
              })
            : [];
          const msgCountByConvId = new Map(
            msgCountData.map(mc => [mc.conversationId, mc._count.id]),
          );

          // Canonical phone → contact haritası (tüm format varyantlarını kapsa)
          const contactByPhone = new Map<string, (typeof existingContacts)[0]>();
          for (const contact of existingContacts) {
            const keys = contactPhoneLookupKeys(contact.phone);
            for (const key of keys) {
              if (!contactByPhone.has(key)) contactByPhone.set(key, contact);
            }
          }

          this.logger.debug(
            `Oturum ${session.name}: ${sortedChats.length} sohbet, ${existingContacts.length} DB'de mevcut`,
          );

          for (const chat of sortedChats) {
            try {
              const chatId = chat.id?._serialized || chat.id;
              const rawPhone = chatId.replace('@c.us', '');
              if (!rawPhone || rawPhone.length < 6) continue;
              const phone = canonicalContactPhone(rawPhone) || rawPhone;

              // DB-first kontrol
              const existingContact = contactByPhone.get(phone) ?? contactByPhone.get(rawPhone);

              if (existingContact) {
                // ── Kişi DB'de mevcut: WAHA'ya yeniden sorma ──
                const conv = existingContact.conversations[0];
                const msgCount = conv ? (msgCountByConvId.get(conv.id) ?? 0) : 0;

                // İsim fallback ise WAHA sohbet listesindeki isimle güncelle
                const chatName = (chat.name || chat.pushname || '').trim();
                if (chatName && isFallbackContactName(existingContact.name, existingContact.phone)) {
                  await this.prisma.contact
                    .update({
                      where: { id: existingContact.id },
                      data: { name: chatName },
                    })
                    .catch(() => {});
                  this.logger.debug(`İsim güncellendi (DB-first): ${phone} → ${chatName}`);
                }

                if (!conv) {
                  // Kişi var ama bu oturum için konuşma yok → oluştur + senkron
                  const newConv = await this.conversationsService.findOrCreate(
                    existingContact.id,
                    session.id,
                  );
                  const result = await this.controller.syncMessagesCore(newConv.id);
                  totalSynced += result.synced;
                  if (result.synced > 0) totalConversations++;
                } else if (msgCount === 0) {
                  // Konuşma var ama hiç mesaj yok → ilk yükleme
                  const result = await this.controller.syncMessagesCore(conv.id);
                  totalSynced += result.synced;
                  if (result.synced > 0) totalConversations++;
                } else {
                  // Kişi + konuşma + mesaj hepsi DB'de → webhook zaten hallediyor, atla
                  dbFirst++;
                  this.logger.debug(`DB-first atlandı (${msgCount} mesaj): ${phone}`);
                }

                // Avatar yalnızca eksikse al (DB'deki kişi için)
                if (!existingContact.avatarUrl) {
                  this.wahaService
                    .getProfilePicture(session.name, phone)
                    .then((picUrl) => {
                      if (picUrl) {
                        return this.contactsService.fetchAndSaveProfilePicture(
                          existingContact.id,
                          phone,
                          picUrl,
                        );
                      }
                    })
                    .catch(() => {});
                }
              } else {
                // ── Yeni kişi: tam akış ──
                const contactName = (chat.name || chat.pushname || '').trim() || phone;
                const contact = await this.contactsService.findOrCreate(
                  phone,
                  contactName,
                  session.organizationId,
                );
                const conversation = await this.conversationsService.findOrCreate(
                  contact.id,
                  session.id,
                );
                const result = await this.controller.syncMessagesCore(conversation.id);
                totalSynced += result.synced;
                if (result.synced > 0) totalConversations++;

                if (!contact.avatarUrl) {
                  this.wahaService
                    .getProfilePicture(session.name, phone)
                    .then((picUrl) => {
                      if (picUrl) {
                        return this.contactsService.fetchAndSaveProfilePicture(
                          contact.id,
                          phone,
                          picUrl,
                        );
                      }
                    })
                    .catch(() => {});
                }
              }
            } catch (err: any) {
              failedChats++;
              this.logger.warn(`Senkron hatası (${chat.id?._serialized}): ${err.message}`);
            }
          }
        } catch (err: any) {
          this.logger.error(`Oturum senkron hatası (${session.name}): ${err.message}`);
        }
      }

      this.logger.log(
        `Senkron tamamlandı: ${totalSynced} mesaj, ${totalConversations} konuşma` +
          (dbFirst > 0 ? `, ${dbFirst} DB-first atlandı` : '') +
          (failedChats > 0 ? `, ${failedChats} başarısız sohbet` : ''),
      );
    } catch (err: any) {
      this.logger.error(`Otomatik senkron hatası: ${err.message}`);
    }
  }
}
