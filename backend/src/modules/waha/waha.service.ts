import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { whereWhatsappSessionsForOrg } from '../../common/org-session-scope';
import axios, { AxiosInstance } from 'axios';

/** Oturum API çağrılarında çoklu kiracı ayrımı */
export type WahaAccessContext = {
  role: string;
  organizationId: string | null;
};

@Injectable()
export class WahaService implements OnModuleInit {
  private readonly logger = new Logger(WahaService.name);
  private readonly http: AxiosInstance;
  private readonly webhookUrl: string;
  readonly syncChatLimit: number;
  readonly syncMessageLimit: number;
  readonly syncTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    const baseURL = this.config.get('WAHA_API_URL', 'http://localhost:3001');
    const rawKey = this.config.get<string>('WAHA_API_KEY', '') ?? '';
    const apiKey = typeof rawKey === 'string' ? rawKey.trim() : '';

    this.syncChatLimit = parseInt(this.config.get('SYNC_CHAT_LIMIT', '200'), 10);
    this.syncMessageLimit = parseInt(this.config.get('SYNC_MESSAGE_LIMIT', '200'), 10);
    this.syncTimeoutMs = parseInt(this.config.get('SYNC_TIMEOUT_MS', '120000'), 10);

    const rawTimeout = parseInt(this.config.get('WAHA_REQUEST_TIMEOUT_MS', '120000'), 10);
    this.requestTimeoutMs = Number.isFinite(rawTimeout)
      ? Math.min(Math.max(rawTimeout, 5_000), 300_000)
      : 120_000;

    this.http = axios.create({
      baseURL,
      headers: apiKey ? { 'X-Api-Key': apiKey } : {},
      timeout: this.requestTimeoutMs,
    });

    this.webhookUrl = this.config.get(
      'WAHA_WEBHOOK_URL',
      'http://host.docker.internal:4000/api/waha/webhook',
    );

    this.logger.log(
      `Sync ayarları: chatLimit=${this.syncChatLimit}, msgLimit=${this.syncMessageLimit}, timeout=${this.syncTimeoutMs}ms`,
    );
  }

  async onModuleInit() {
    setTimeout(async () => {
      await this.syncSessions({
        role: 'SUPERADMIN',
        organizationId: null,
      });
      await this.ensureWebhooksRegistered();
    }, 5000);
  }

  async ensureWebhooksRegistered() {
    try {
      const sessions = await this.getAllSessionsFromWaha();
      for (const session of sessions) {
        const hasWebhook = session.config?.webhooks?.some(
          (w: any) => w.url === this.webhookUrl,
        );
        if (!hasWebhook && (session.status === 'WORKING' || session.status === 'SCAN_QR_CODE')) {
          this.logger.warn(`Oturum ${session.name} webhook eksik, kaydediliyor...`);
          try {
            await this.http.put(`/api/sessions/${encodeURIComponent(session.name)}`, {
              config: {
                webhooks: [
                  {
                    url: this.webhookUrl,
                    events: ['message', 'message.any', 'message.ack', 'message.reaction', 'session.status'],
                  },
                ],
              },
            });
            this.logger.log(`Webhook kaydedildi: ${session.name}`);
          } catch (err: any) {
            this.logger.error(`Webhook kaydedilemedi (${session.name}): ${err.message}`);
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Webhook kontrol hatası: ${err.message}`);
    }
  }

  /** Yalnızca bu bağlamdaki DB satırlarını WAHA ile günceller; başka kiracı oturumu oluşturmaz */
  async syncSessions(ctx: WahaAccessContext) {
    try {
      if (ctx.organizationId && ctx.role !== 'SUPERADMIN') {
        await this.reconcileNullOrgSessionsForTenant(ctx.organizationId);
      }
      const where = this.dbWhereForSessions(ctx);
      const dbRows = await this.prisma.whatsappSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
      const wahaSessions = await this.getAllSessionsFromWaha();
      this.logger.log(
        `WAHA ${wahaSessions.length} oturum; DB’de ${dbRows.length} satır senkron kapsamında`,
      );

      const wahaMap = new Map<string, (typeof wahaSessions)[0]>();
      for (const ws of wahaSessions) {
        wahaMap.set(ws.name, ws);
      }

      const statusMap: Record<string, string> = {
        WORKING: 'WORKING',
        SCAN_QR_CODE: 'SCAN_QR',
        STARTING: 'STARTING',
        STOPPED: 'STOPPED',
        FAILED: 'FAILED',
      };

      for (const row of dbRows) {
        const ws = wahaMap.get(row.name);
        if (!ws) continue;
        const mappedStatus = (statusMap[ws.status] || 'STOPPED') as any;
        await this.prisma.whatsappSession.update({
          where: { id: row.id },
          data: {
            status: mappedStatus,
            phone: ws.me?.id
              ? ws.me.id.replace('@c.us', '')
              : row.phone,
          },
        });
        this.logger.log(
          `Oturum senkronize edildi: ${row.name} (${mappedStatus})`,
        );
      }
    } catch (error: any) {
      this.logger.warn(
        `WAHA oturum senkronizasyonu başarısız: ${error.message}`,
      );
    }
  }

  async getAllSessionsFromWaha(): Promise<any[]> {
    try {
      const response = await this.http.get('/api/sessions');
      return response.data || [];
    } catch (error: any) {
      this.logger.error('WAHA oturumları alınamadı', error.message);
      return [];
    }
  }

  async getAllSessionsMerged(ctx: WahaAccessContext) {
    if (ctx.organizationId && ctx.role !== 'SUPERADMIN') {
      await this.reconcileNullOrgSessionsForTenant(ctx.organizationId);
    }
    const where = this.dbWhereForSessions(ctx);
    const [dbSessions, wahaSessions] = await Promise.all([
      this.prisma.whatsappSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      }),
      this.getAllSessionsFromWaha(),
    ]);

    const wahaMap = new Map<string, any>();
    for (const ws of wahaSessions) {
      wahaMap.set(ws.name, ws);
    }

    const statusMap: Record<string, string> = {
      WORKING: 'WORKING',
      SCAN_QR_CODE: 'SCAN_QR',
      STARTING: 'STARTING',
      STOPPED: 'STOPPED',
      FAILED: 'FAILED',
    };

    const merged = dbSessions.map((db) => {
      const waha = wahaMap.get(db.name);
      if (waha) {
        return {
          ...db,
          status: statusMap[waha.status] || db.status,
          phone:
            waha.me?.id?.replace('@c.us', '') || db.phone,
          wahaStatus: waha.status,
        };
      }
      return { ...db, wahaStatus: null };
    });

    if (ctx.role === 'SUPERADMIN') {
      const dbNames = new Set(dbSessions.map((d) => d.name));
      for (const ws of wahaSessions) {
        if (!dbNames.has(ws.name)) {
          merged.push({
            id: ws.name,
            name: ws.name,
            phone: ws.me?.id?.replace('@c.us', '') || null,
            status: ws.status === 'WORKING' ? 'WORKING' : 'STOPPED',
            wahaStatus: ws.status,
            webhookUrl: null,
            organizationId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any);
        }
      }
    }

    return merged;
  }

  async startSession(name: string, ctx: WahaAccessContext) {
    const existing = await this.prisma.whatsappSession.findUnique({
      where: { name },
    });
    await this.guardStartSessionOrg(existing, ctx);
    const orgIdForCreate =
      ctx.role === 'SUPERADMIN' ? null : ctx.organizationId;

    try {
      const response = await this.http.post('/api/sessions/start', {
        name,
        config: {
          webhooks: [
            {
              url: this.webhookUrl,
              events: ['message', 'message.any', 'message.ack', 'message.reaction', 'session.status'],
            },
          ],
        },
      });

      await this.prisma.whatsappSession.upsert({
        where: { name },
        update: {
          status: 'STARTING',
          ...(ctx.organizationId && ctx.role !== 'SUPERADMIN'
            ? { organizationId: ctx.organizationId }
            : {}),
        },
        create: {
          name,
          status: 'STARTING',
          organizationId: orgIdForCreate,
        },
      });

      return response.data;
    } catch (error: any) {
      if (
        error.response?.status === 422 ||
        error.response?.data?.message?.includes('already')
      ) {
        this.logger.warn(`Oturum zaten mevcut: ${name}, webhook güncelleniyor`);
        return this.updateWebhookAndSync(name, ctx);
      }
      this.logger.error(`Oturum başlatılamadı: ${name}`, error.message);
      throw error;
    }
  }

  async updateWebhookAndSync(name: string, ctx: WahaAccessContext) {
    const existing = await this.prisma.whatsappSession.findUnique({
      where: { name },
    });
    await this.guardStartSessionOrg(existing, ctx);
    const orgIdForCreate =
      ctx.role === 'SUPERADMIN' ? null : ctx.organizationId;

    try {
      await this.http.put(`/api/sessions/${encodeURIComponent(name)}`, {
        config: {
          webhooks: [
            {
              url: this.webhookUrl,
              events: ['message', 'message.any', 'message.ack', 'message.reaction', 'session.status'],
            },
          ],
        },
      });
    } catch {
      this.logger.warn(`Webhook güncellenemedi: ${name}`);
    }

    const status = await this.getSessionStatus(name);
    const statusMap: Record<string, string> = {
      WORKING: 'WORKING',
      SCAN_QR_CODE: 'SCAN_QR',
      STARTING: 'STARTING',
      STOPPED: 'STOPPED',
      FAILED: 'FAILED',
    };
    const mappedStatus = (statusMap[status?.status] || 'STARTING') as any;

    await this.prisma.whatsappSession.upsert({
      where: { name },
      update: {
        status: mappedStatus,
        phone: status?.me?.id?.replace('@c.us', '') || undefined,
        ...(ctx.organizationId && ctx.role !== 'SUPERADMIN'
          ? { organizationId: ctx.organizationId }
          : {}),
      },
      create: {
        name,
        status: mappedStatus,
        phone: status?.me?.id?.replace('@c.us', '') || null,
        organizationId: orgIdForCreate,
      },
    });

    return { name, status: mappedStatus };
  }

  async stopSession(name: string, ctx: WahaAccessContext) {
    await this.assertSessionInTenant(name, ctx);
    try {
      const response = await this.http.post('/api/sessions/stop', {
        name,
        logout: false,
      });
      await this.prisma.whatsappSession.updateMany({
        where: { name },
        data: { status: 'STOPPED' },
      });
      return response.data;
    } catch (error: any) {
      this.logger.error(`Oturum durdurulamadı: ${name}`, error.message);
      throw error;
    }
  }

  /** WAHA ve veritabanından oturumu kaldırır (ilişkili konuşma/mesajlar cascade ile silinir). */
  async deleteSession(name: string, ctx: WahaAccessContext) {
    await this.assertSessionInTenant(name, ctx);
    const encoded = encodeURIComponent(name);
    try {
      await this.http.delete(`/api/sessions/${encoded}`);
    } catch (error: any) {
      this.logger.warn(
        `WAHA oturum silme atlandı veya başarısız: ${name} — ${error.message}`,
      );
    }
    const result = await this.prisma.whatsappSession.deleteMany({
      where: { name },
    });
    return { deleted: result.count > 0 };
  }

  async getSessionStatus(name: string, ctx?: WahaAccessContext) {
    if (ctx) await this.assertSessionInTenant(name, ctx);
    try {
      const response = await this.http.get(
        `/api/sessions/${encodeURIComponent(name)}`,
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(`Oturum durumu alınamadı: ${name}`, error.message);
      return null;
    }
  }

  async getQrCode(name: string, ctx: WahaAccessContext) {
    await this.assertSessionInTenant(name, ctx);
    try {
      const response = await this.http.get(
        `/api/${encodeURIComponent(name)}/auth/qr`,
        {
          params: { format: 'image' },
          responseType: 'arraybuffer',
        },
      );
      return Buffer.from(response.data).toString('base64');
    } catch (error: any) {
      this.logger.error(`QR alınamadı: ${name}`, error.message);
      return null;
    }
  }

  private dbWhereForSessions(
    ctx: WahaAccessContext,
  ): Prisma.WhatsappSessionWhereInput {
    return whereWhatsappSessionsForOrg({
      role: ctx.role,
      organizationId: ctx.organizationId,
    });
  }

  /** Tek org ile ilişkili null-org satırları kalıcı olarak düzeltir */
  private async reconcileNullOrgSessionsForTenant(
    organizationId: string,
  ): Promise<void> {
    const candidates = await this.prisma.whatsappSession.findMany({
      where: {
        organizationId: null,
        conversations: {
          some: { contact: { organizationId } },
        },
      },
      include: {
        conversations: {
          include: {
            contact: { select: { organizationId: true } },
          },
        },
      },
    });

    for (const s of candidates) {
      const orgIds = new Set(
        s.conversations
          .map((c) => c.contact.organizationId)
          .filter((id): id is string => id != null),
      );
      if (orgIds.size === 1 && orgIds.has(organizationId)) {
        await this.prisma.whatsappSession.update({
          where: { id: s.id },
          data: { organizationId },
        });
        this.logger.log(
          `Oturum organizasyona bağlandı: ${s.name} → ${organizationId}`,
        );
      }
    }
  }

  private async guardStartSessionOrg(
    existing: { id: string; organizationId: string | null } | null,
    ctx: WahaAccessContext,
  ): Promise<void> {
    if (ctx.role === 'SUPERADMIN') return;
    if (!ctx.organizationId) {
      throw new BadRequestException('Organizasyon bulunamadı');
    }
    if (
      existing?.organizationId &&
      existing.organizationId !== ctx.organizationId
    ) {
      throw new ForbiddenException(
        'Bu oturum adı başka bir organizasyonda kayıtlı',
      );
    }
    if (existing && !existing.organizationId) {
      const foreign = await this.prisma.conversation.findFirst({
        where: {
          sessionId: existing.id,
          contact: {
            AND: [
              { organizationId: { not: null } },
              { organizationId: { not: ctx.organizationId } },
            ],
          },
        },
      });
      if (foreign) {
        throw new ForbiddenException(
          'Bu oturum adı başka bir organizasyonda kullanılıyor',
        );
      }
    }
  }

  private async assertSessionInTenant(
    name: string,
    ctx: WahaAccessContext,
  ): Promise<void> {
    if (ctx.role !== 'SUPERADMIN' && !ctx.organizationId) {
      throw new ForbiddenException('Organizasyon bulunamadı');
    }

    const row = await this.prisma.whatsappSession.findFirst({
      where: {
        name,
        ...whereWhatsappSessionsForOrg({
          role: ctx.role,
          organizationId: ctx.organizationId,
        }),
      },
    });
    if (!row) {
      const any = await this.prisma.whatsappSession.findUnique({
        where: { name },
      });
      if (!any) {
        throw new NotFoundException('Oturum bulunamadı');
      }
      throw new ForbiddenException('Bu oturuma erişim yetkiniz yok');
    }
  }

  /**
   * Webhook vb. WAHA’dan medya indirir; axios örneği X-Api-Key taşır (Plus’ta zorunlu olabilir).
   * Tam veya göreli URL; göreli ise WAHA_API_URL ile birleştirilir.
   */
  async downloadMediaBuffer(url: string): Promise<Buffer | null> {
    const trimmed = (url || '').trim();
    if (!trimmed) return null;
    const base = (this.config.get('WAHA_API_URL', 'http://localhost:3001') || '').replace(
      /\/$/,
      '',
    );
    const target = trimmed.startsWith('http')
      ? trimmed
      : `${base}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
    try {
      const response = await this.http.get(target, {
        responseType: 'arraybuffer',
        timeout: 120_000,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024,
      });
      return Buffer.from(response.data as ArrayBuffer);
    } catch (error: any) {
      const detail = error.response?.data
        ? String(error.response.data)
        : error.message;
      this.logger.error(`WAHA medya indirilemedi: ${target} — ${detail}`);
      return null;
    }
  }

  async sendText(sessionName: string, chatId: string, text: string) {
    try {
      const response = await this.http.post('/api/sendText', {
        session: sessionName,
        chatId,
        text,
      });
      return response.data;
    } catch (error: any) {
      const detail =
        error.response?.data?.message ||
        error.response?.data?.error ||
        (typeof error.response?.data === 'string'
          ? error.response.data
          : JSON.stringify(error.response?.data || {}));
      this.logger.error(
        `Mesaj gönderilemedi: ${chatId} — ${error.message}${detail ? ` | ${detail}` : ''}`,
      );
      throw error;
    }
  }

  async sendImage(
    sessionName: string,
    chatId: string,
    file: { mimetype: string; data: string; filename: string; width?: number; height?: number },
    caption?: string,
  ) {
    try {
      const response = await this.http.post('/api/sendImage', {
        session: sessionName,
        chatId,
        file: {
          mimetype: file.mimetype,
          data: file.data,
          filename: file.filename,
          ...(file.width && file.height ? { width: file.width, height: file.height } : {}),
        },
        caption: caption || '',
      });
      return response.data;
    } catch (error: any) {
      const detail = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      this.logger.error(`Resim gonderilemedi: ${chatId} - ${detail}`);
      throw error;
    }
  }

  async sendFile(
    sessionName: string,
    chatId: string,
    file: { mimetype: string; data: string; filename: string },
    caption?: string,
  ) {
    try {
      const response = await this.http.post('/api/sendFile', {
        session: sessionName,
        chatId,
        file,
        caption: caption || '',
      });
      return response.data;
    } catch (error: any) {
      const detail = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      this.logger.error(`Dosya gonderilemedi: ${chatId} - ${detail}`);
      throw error;
    }
  }

  async getProfilePicture(
    sessionName: string,
    contactId: string,
  ): Promise<string | null> {
    const chatId = contactId.includes('@') ? contactId : `${contactId}@c.us`;

    const endpoints = [
      { url: `/api/contacts/profile-picture`, params: { contactId: chatId, session: sessionName } },
      { url: `/api/${encodeURIComponent(sessionName)}/contacts/profile-picture`, params: { contactId: chatId } },
    ];

    for (const ep of endpoints) {
      try {
        const response = await this.http.get(ep.url, {
          params: ep.params,
          timeout: 15000,
        });
        const picUrl =
          response.data?.profilePictureURL ||
          response.data?.profilePicture ||
          response.data?.url ||
          null;
        if (picUrl) {
          this.logger.debug(`Profil fotoğrafı bulundu (${contactId}): ${picUrl}`);
          return picUrl;
        }
      } catch (error: any) {
        const status = error.response?.status;
        if (status === 404) {
          this.logger.debug(
            `Profil fotoğrafı: ${ep.url} 404 (${contactId})`,
          );
          continue;
        }
        this.logger.debug(
          `Profil fotoğrafı alınamadı: ${ep.url} ${contactId} - ${error.message}`,
        );
      }
    }
    return null;
  }

  /**
   * WAHA Contacts: isim / pushname (sohbet açılışında eksik kişi bilgisini tamamlamak için).
   */
  async getContactDetails(
    sessionName: string,
    chatId: string,
  ): Promise<{
    name?: string | null;
    pushname?: string | null;
    shortName?: string | null;
    number?: string | null;
    notify?: string | null;
    verifiedName?: string | null;
  } | null> {
    const id = /@(c\.us|g\.us|lid)$/i.test(String(chatId))
      ? String(chatId).trim()
      : `${String(chatId).replace(/\D/g, '')}@c.us`;
    if (!id || id === '@c.us') return null;

    const endpoints = [
      {
        url: `/api/contacts`,
        params: { contactId: id, session: sessionName },
      },
      {
        url: `/api/${encodeURIComponent(sessionName)}/contacts`,
        params: { contactId: id },
      },
    ];

    for (const ep of endpoints) {
      try {
        const response = await this.http.get(ep.url, {
          params: ep.params,
          timeout: 12000,
        });
        let d = response.data;
        if (Array.isArray(d) && d.length > 0) d = d[0];
        if (d && typeof d === 'object') {
          this.logger.debug(
            `WAHA kişi detayı (${id}): name=${d.name}, pushname=${d.pushname}, shortName=${d.shortName}, number=${d.number}, notify=${d.notify}, verifiedName=${d.verifiedName}`,
          );
          return d;
        }
      } catch (error: any) {
        const status = error.response?.status;
        if (status === 404) continue;
        this.logger.debug(
          `Kişi detayı alınamadı: ${ep.url} ${id} - ${error.message}`,
        );
      }
    }
    return null;
  }

  async getChatMessages(
    sessionName: string,
    chatId: string,
    limit?: number,
  ): Promise<any[]> {
    const effectiveLimit = limit ?? this.syncMessageLimit;
    try {
      const fullChatId = chatId.includes('@') ? chatId : `${chatId}@c.us`;
      const encSession = encodeURIComponent(sessionName);
      const encChat = encodeURIComponent(fullChatId);
      const response = await this.http.get(
        `/api/${encSession}/chats/${encChat}/messages`,
        { params: { limit: effectiveLimit, downloadMedia: true }, timeout: this.syncTimeoutMs },
      );
      return response.data || [];
    } catch (error: any) {
      this.logger.error(`Mesajlar alınamadı: ${chatId} - ${error.message}`);
      return [];
    }
  }

  /**
   * LID → bağlı telefon (pn). WAHA: GET /api/{session}/lids/{lid}
   * Yanıt örn. { pn: "905551234567@c.us" }
   */
  async getLinkedPnFromLid(
    sessionName: string,
    lidJid: string,
  ): Promise<string | null> {
    const id = /@lid$/i.test(String(lidJid).trim())
      ? String(lidJid).trim()
      : `${String(lidJid).replace(/\D/g, '')}@lid`;
    if (id === '@lid') return null;
    try {
      const encSession = encodeURIComponent(sessionName);
      const encId = encodeURIComponent(id);
      const response = await this.http.get(`/api/${encSession}/lids/${encId}`, {
        timeout: 12000,
      });
      const pn = response.data?.pn;
      return typeof pn === 'string' && pn.trim() ? pn.trim() : null;
    } catch (error: any) {
      this.logger.debug(`LID pn alınamadı (${id}): ${error?.message}`);
      return null;
    }
  }

  async getChats(sessionName: string, limit?: number): Promise<any[]> {
    const effectiveLimit = limit ?? this.syncChatLimit;
    try {
      const response = await this.http.get(`/api/${encodeURIComponent(sessionName)}/chats`, {
        params: { limit: effectiveLimit },
        timeout: this.syncTimeoutMs,
      });
      return response.data || [];
    } catch (error: any) {
      this.logger.error(`Chat listesi alınamadı: ${error.message}`);
      return [];
    }
  }

  /** WAHA: grup meta (subject vb.) — webhook’ta eksik başlık için */
  async getGroupById(sessionName: string, groupJid: string): Promise<any | null> {
    const id = groupJid.includes('@g.us')
      ? groupJid
      : `${String(groupJid).replace(/\D/g, '')}@g.us`;
    try {
      const encSession = encodeURIComponent(sessionName);
      const encId = encodeURIComponent(id);
      const response = await this.http.get(`/api/${encSession}/groups/${encId}`, {
        timeout: Math.min(this.syncTimeoutMs, 12000),
      });
      return response.data ?? null;
    } catch (error: any) {
      this.logger.debug(`Grup meta alınamadı (${id}): ${error.message}`);
      return null;
    }
  }

  /** Üye listesi (motorlar arası tutarlı v2) */
  async getGroupParticipantsV2(
    sessionName: string,
    groupJid: string,
  ): Promise<{ id: string; role?: string }[]> {
    const id = groupJid.includes('@g.us')
      ? groupJid
      : `${String(groupJid).replace(/\D/g, '')}@g.us`;
    try {
      const encSession = encodeURIComponent(sessionName);
      const encId = encodeURIComponent(id);
      const response = await this.http.get(
        `/api/${encSession}/groups/${encId}/participants/v2`,
        { timeout: Math.min(this.syncTimeoutMs, 15000) },
      );
      const data = response.data;
      return Array.isArray(data) ? data : [];
    } catch (error: any) {
      this.logger.debug(`Grup katılımcıları alınamadı (${id}): ${error.message}`);
      return [];
    }
  }

  async editMessage(
    sessionName: string,
    chatId: string,
    messageId: string,
    text: string,
  ): Promise<any> {
    try {
      const encodedChatId = encodeURIComponent(chatId);
      const encodedMsgId = encodeURIComponent(messageId);
      const response = await this.http.put(
        `/api/${sessionName}/chats/${encodedChatId}/messages/${encodedMsgId}`,
        { text },
      );
      return response.data;
    } catch (error: any) {
      const detail = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      this.logger.error(`Mesaj düzenlenemedi: ${messageId} - ${detail}`);
      throw error;
    }
  }

  /** WAHA Plus - Mesaja yanıt gönder */
  async sendReply(
    sessionName: string,
    chatId: string,
    text: string,
    quotedMessageId: string,
  ): Promise<any> {
    try {
      const response = await this.http.post('/api/sendText', {
        session: sessionName,
        chatId,
        text,
        reply_to: quotedMessageId,
      });
      return response.data;
    } catch (error: any) {
      const detail = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      this.logger.error(`Yanıt gönderilemedi: ${chatId} - ${detail}`);
      throw error;
    }
  }

  /** WAHA Plus - Mesaj silme */
  async deleteMessage(
    sessionName: string,
    chatId: string,
    messageId: string,
    forEveryone: boolean = true,
  ): Promise<any> {
    try {
      const encodedChatId = encodeURIComponent(chatId);
      const encodedMsgId = encodeURIComponent(messageId);
      const response = await this.http.delete(
        `/api/${sessionName}/chats/${encodedChatId}/messages/${encodedMsgId}`,
        { data: { forEveryone } },
      );
      return response.data;
    } catch (error: any) {
      const detail = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      this.logger.error(`Mesaj silinemedi: ${messageId} - ${detail}`);
      throw error;
    }
  }

  /** WAHA Plus - Emoji tepki gönder */
  async sendReaction(
    sessionName: string,
    chatId: string,
    messageId: string,
    emoji: string,
  ): Promise<any> {
    try {
      const encodedChatId = encodeURIComponent(chatId);
      const encodedMsgId = encodeURIComponent(messageId);
      const response = await this.http.post(
        `/api/${sessionName}/chats/${encodedChatId}/messages/${encodedMsgId}/reaction`,
        { reaction: emoji },
      );
      return response.data;
    } catch (error: any) {
      // Eski WAHA sürümleri için legacy endpoint fallback
      try {
        const legacy = await this.http.post('/api/reaction', {
          session: sessionName,
          chatId,
          messageId,
          reaction: emoji,
        });
        return legacy.data;
      } catch (legacyError: any) {
        const detail = legacyError.response?.data
          ? JSON.stringify(legacyError.response.data)
          : legacyError.message;
        this.logger.error(`Tepki gönderilemedi: ${messageId} - ${detail}`);
        throw legacyError;
      }
    }
  }

  /** WAHA Plus - Konum gönder */
  async sendLocation(
    sessionName: string,
    chatId: string,
    latitude: number,
    longitude: number,
    title?: string,
    address?: string,
  ): Promise<any> {
    try {
      const response = await this.http.post('/api/sendLocation', {
        session: sessionName,
        chatId,
        location: {
          latitude,
          longitude,
          name: title || undefined,
          address: address || undefined,
        },
      });
      return response.data;
    } catch (error: any) {
      const detail = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      this.logger.error(`Konum gönderilemedi: ${chatId} - ${detail}`);
      throw error;
    }
  }

  async downloadFile(
    sessionName: string,
    fileId: string,
  ): Promise<{ data: Buffer; mimetype: string; filename: string } | null> {
    try {
      const response = await this.http.get(
        `/api/files/${sessionName}/${fileId}`,
        { responseType: 'arraybuffer', timeout: this.requestTimeoutMs },
      );
      const contentType =
        response.headers['content-type'] || 'application/octet-stream';
      const contentDisposition = response.headers['content-disposition'] || '';
      const filenameMatch = contentDisposition.match(/filename="?([^";\n]+)"?/);
      const filename = filenameMatch?.[1] || fileId;

      return {
        data: Buffer.from(response.data),
        mimetype: contentType,
        filename,
      };
    } catch (error: any) {
      this.logger.error(
        `Dosya indirilemedi: ${sessionName}/${fileId} - ${error.message}`,
      );
      return null;
    }
  }

  /**
   * @deprecated Yeni kod için extractPhoneFromIndividualJid kullanın
   * Eski: chatId'den telefon çıkarır (hem @c.us hem @g.us için - hatalı!)
   * Bu fonksiyon geriye uyumluluk için korunuyor.
   */
  extractPhoneFromChatId(chatId: string): string {
    // Yeni utility'leri kullan
    const { extractPhoneFromIndividualJid, isIndividualChat } = require('../../common/contact-phone');
    
    // Sadece bireysel sohbetler için telefon çıkar
    if (isIndividualChat(chatId)) {
      return extractPhoneFromIndividualJid(chatId) || '';
    }
    
    // Grup ve diğer tipler için boş döndür
    return '';
  }

  /**
   * Bir kişiyle (contactId) aktif konuşması olan WORKING session'ı döner.
   * Bulamazsa herhangi bir WORKING session döner.
   * Hiç WORKING yoksa null döner.
   */
  async getWorkingSessionForContact(contactId: string): Promise<string | null> {
    // Önce bu kişiyle konuşması olan session'ı bul
    const conv = await this.prisma.conversation.findFirst({
      where: { contactId },
      include: { session: true },
      orderBy: { lastMessageAt: 'desc' },
    });
    if (conv?.session?.status === 'WORKING') {
      return conv.session.name;
    }

    // Yoksa herhangi bir WORKING session bul
    const session = await this.prisma.whatsappSession.findFirst({
      where: { status: 'WORKING' },
      orderBy: { createdAt: 'asc' },
    });
    return session?.name || null;
  }
}
