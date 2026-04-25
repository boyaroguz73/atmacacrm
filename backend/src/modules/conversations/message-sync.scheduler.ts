import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WahaService } from '../waha/waha.service';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { canonicalContactPhone, isFallbackContactName } from '../../common/contact-phone';

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

  // 5 dakikalık otomatik senkron kullanıcı talebiyle kapatıldı.
  // Gerekirse manuel tetikleme veya tek seferlik startup sync kullanılabilir.

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
            return (
              cid &&
              (cid.endsWith('@c.us') || cid.endsWith('@g.us')) &&
              cid !== 'status@broadcast' &&
              !cid.includes('@broadcast')
            );
          });

          /** timestamp olmayan sohbetler eskiden tamamen atlanıyordu; sonda yine de senkronlanır */
          const sortedChats = [...personalChats].sort(
            (a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0),
          );

          this.logger.debug(`Oturum ${session.name}: ${sortedChats.length} sohbet senkron ediliyor (toplam: ${personalChats.length})`);

          for (const chat of sortedChats) {
            try {
              const chatId = chat.id?._serialized || chat.id;
              const isGroup = chatId.endsWith('@g.us');
              const rawPhone = isGroup ? '' : chatId.replace('@c.us', '');
              if (!isGroup && (!rawPhone || rawPhone.length < 6)) continue;
              const phone = isGroup ? '' : (canonicalContactPhone(rawPhone) || rawPhone);

              // WAHA'da chat.name bazı hesaplarda kendi işletme adını dönebilir; pushname'i öncele.
              const candidateName = chat.pushname || chat.name || chat.subject || '';
              const contactName =
                isGroup
                  ? (candidateName || 'WhatsApp Grubu')
                  : (!isFallbackContactName(candidateName, phone) ? candidateName : undefined);
              const contact = isGroup
                ? await this.contactsService.findOrCreateForGroup(chatId, contactName || 'WhatsApp Grubu', session.organizationId)
                : await this.contactsService.findOrCreate(phone, contactName, session.organizationId);
              const conversation = isGroup
                ? await this.conversationsService.findOrCreateGroup(contact.id, session.id, chatId, contactName || 'WhatsApp Grubu')
                : await this.conversationsService.findOrCreate(contact.id, session.id);

              const result = await this.controller.syncMessagesCore(conversation.id, {
                downloadMedia: false,
              });
              totalSynced += result.synced;
              if (result.synced > 0) totalConversations++;

              if (!contact.avatarUrl && !isGroup) {
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
}
