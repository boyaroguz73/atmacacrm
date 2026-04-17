import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WahaService } from '../waha/waha.service';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { canonicalContactPhone, contactPhoneLookupKeys, extractPhoneFromIndividualJid, isValidPhoneNumber } from '../../common/contact-phone';

@Injectable()
export class MessageSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(MessageSyncScheduler.name);
  private controller: ConversationsController;

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
    this.logger.log('Periyodik mesaj senkronu başlıyor...');
    await this.wahaService.ensureWebhooksRegistered();
    await this.syncAllSessions();
  }

  private async runStartupSync() {
    this.logger.log('Başlangıç mesaj senkronu başlıyor...');
    await this.syncAllSessions();
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

      // LID duplicate temizligi: pushName ile numara kontagi varsa LID'i merge et
      for (const session of sessions) {
        try {
          await this.cleanupLidDuplicates(session.name);
        } catch (err: any) {
          this.logger.warn(`LID temizlik hatasi (${session.name}): ${err.message}`);
        }
      }

      let totalSynced = 0;
      let totalConversations = 0;
      let failedChats = 0;

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

          this.logger.debug(`Oturum ${session.name}: ${sortedChats.length} sohbet senkron ediliyor (toplam: ${personalChats.length})`);

          for (const chat of sortedChats) {
            try {
              const chatId = chat.id?._serialized || chat.id;
              const rawPhone = chatId.replace('@c.us', '');
              if (!rawPhone || rawPhone.length < 6) continue;
              const phone = canonicalContactPhone(rawPhone) || rawPhone;

              const contactName = chat.name || chat.pushname || phone;
              const contact = await this.contactsService.findOrCreate(phone, contactName, session.organizationId);
              const conversation = await this.conversationsService.findOrCreate(
                contact.id,
                session.id,
              );

              // Incremental: WAHA'daki son mesaj zamani DB'dekinden yeni degilse atla
              const chatTimestampMs = chat.timestamp ? Number(chat.timestamp) * 1000 : 0;
              const lastKnownMs = conversation.lastMessageAt
                ? new Date(conversation.lastMessageAt).getTime()
                : 0;
              if (chatTimestampMs && lastKnownMs && chatTimestampMs <= lastKnownMs) {
                continue;
              }

              const result = await this.controller.syncMessagesCore(conversation.id);
              totalSynced += result.synced;
              if (result.synced > 0) totalConversations++;

              if (!contact.avatarUrl) {
                try {
                  const picUrl = await this.wahaService.getProfilePicture(session.name, phone);
                  if (picUrl) {
                    await this.contactsService.fetchAndSaveProfilePicture(contact.id, phone, picUrl);
                  }
                } catch {}
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
        (failedChats > 0 ? `, ${failedChats} başarısız sohbet` : ''),
      );
    } catch (err: any) {
      this.logger.error(`Otomatik senkron hatası: ${err.message}`);
    }
  }

  /**
   * Oturumdaki tum LID kontaklarini tarar, WAHA'dan numara cozer ve ayni numaraya
   * sahip contact varsa LID kontagini (conversation+mesaj) ona merge edip siler.
   */
  private async cleanupLidDuplicates(sessionName: string): Promise<void> {
    const lidContacts = await this.prisma.contact.findMany({
      where: { phone: { startsWith: 'lid:' } },
      select: { id: true, phone: true, organizationId: true },
    });
    if (!lidContacts.length) return;

    let merged = 0;
    for (const lid of lidContacts) {
      try {
        const lidDigits = lid.phone.slice(4).replace(/\D/g, '');
        if (!lidDigits) continue;
        const lidJid = `${lidDigits}@lid`;

        const pnJid = await this.wahaService.getLinkedPnFromLid(sessionName, lidJid);
        if (!pnJid) continue;

        const extracted = extractPhoneFromIndividualJid(pnJid);
        const phoneCanon = extracted || canonicalContactPhone(pnJid.replace(/\D/g, '')) || '';
        if (!phoneCanon || !isValidPhoneNumber(phoneCanon)) continue;

        const lookupKeys = contactPhoneLookupKeys(phoneCanon).filter(Boolean);
        const phoneContact = await this.prisma.contact.findFirst({
          where: { phone: { in: lookupKeys }, id: { not: lid.id } },
        });

        if (phoneContact) {
          // LID'in conversation'larini numara kontagina tasi
          const lidConvs = await this.prisma.conversation.findMany({
            where: { contactId: lid.id },
          });
          for (const conv of lidConvs) {
            const existing = await this.prisma.conversation.findFirst({
              where: { contactId: phoneContact.id, sessionId: conv.sessionId },
            });
            if (existing) {
              await this.prisma.message.updateMany({
                where: { conversationId: conv.id },
                data: { conversationId: existing.id },
              }).catch(() => {});
              await this.prisma.assignment.updateMany({
                where: { conversationId: conv.id },
                data: { conversationId: existing.id },
              }).catch(() => {});
              await this.prisma.conversation.delete({ where: { id: conv.id } }).catch(() => {});
            } else {
              await this.prisma.conversation.update({
                where: { id: conv.id },
                data: { contactId: phoneContact.id },
              }).catch(() => {});
            }
          }
          await this.prisma.contact.delete({ where: { id: lid.id } }).catch(() => {});
          merged++;
        } else {
          // Duplicate yok; LID'i dogrudan numaraya donustur
          try {
            await this.prisma.contact.update({
              where: { id: lid.id },
              data: { phone: phoneCanon },
            });
          } catch { /* ignore */ }
        }
      } catch { /* per-contact hata yut */ }
    }

    if (merged > 0) {
      this.logger.log(`LID temizligi: ${merged} kontak numara kontaklarina merge edildi (${sessionName})`);
    }
  }
}
