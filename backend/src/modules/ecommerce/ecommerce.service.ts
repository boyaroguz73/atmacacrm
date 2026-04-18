import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TsoftApiService } from './tsoft-api.service';
import {
  normalizeComparablePhone,
  normalizeTsoftPhone,
  formatPhoneForTsoft,
} from './phone.util';
import type { CreateTsoftSiteCustomerPayload } from './tsoft.types';

const TSOFT_LABEL = 'T-Soft Site Müşterisi';

/** Başarılı veya yapılandırma eksik: periyodik yenileme */
const STATUS_CACHE_MS_DEFAULT = 120_000;
/** T-Soft login gerçekten denendi ve başarısız: 429 / gereksiz yükü azaltmak için uzun bekleme */
const STATUS_CACHE_MS_AFTER_AUTH_FAIL = 600_000;

type EcommerceStatusResult = {
  menuVisible: boolean;
  healthy: boolean;
  provider: string | null;
  canPushCustomer: boolean;
};

type EcommerceStatusCached = EcommerceStatusResult & { tsoftAuthFailed?: boolean };

@Injectable()
export class EcommerceService {
  private readonly logger = new Logger(EcommerceService.name);
  private readonly statusCache = new Map<string, { at: number; value: EcommerceStatusCached }>();

  constructor(
    private prisma: PrismaService,
    private tsoftApi: TsoftApiService,
  ) {}

  async getStatus(organizationId: string): Promise<EcommerceStatusResult> {
    const hit = this.statusCache.get(organizationId);
    if (hit) {
      const ttl = hit.value.tsoftAuthFailed ? STATUS_CACHE_MS_AFTER_AUTH_FAIL : STATUS_CACHE_MS_DEFAULT;
      if (Date.now() - hit.at < ttl) {
        const { tsoftAuthFailed: _a, ...rest } = hit.value;
        return rest;
      }
    }
    const value = await this.resolveStatus(organizationId);
    this.statusCache.set(organizationId, { at: Date.now(), value });
    const { tsoftAuthFailed: _b, ...rest } = value;
    return rest;
  }

  private async resolveStatus(organizationId: string): Promise<EcommerceStatusCached> {
    try {
      const int = await this.prisma.orgIntegration.findUnique({
        where: {
          organizationId_integrationKey: { organizationId, integrationKey: 'tsoft' },
        },
      });

      if (!int?.isEnabled) {
        return {
          menuVisible: false,
          healthy: false,
          provider: null as string | null,
          canPushCustomer: false,
        };
      }

      const cfg = (int.config || {}) as { baseUrl?: string; apiEmail?: string; apiPassword?: string };
      if (!cfg.baseUrl || !cfg.apiEmail || !cfg.apiPassword) {
        return {
          menuVisible: false,
          healthy: false,
          provider: 'tsoft',
          canPushCustomer: false,
        };
      }

      // Not: /ecommerce/status çağrıları sık tetiklenir (sidebar + contact panel).
      // Burada canlı login denemesi yapmak entegrasyon kapalı/ağ sorunlu durumda
      // gereksiz tekrar denemelere neden olur. Status sadece yapılandırma görünürlüğünü döner;
      // canlı doğrulama için "Bağlantıyı test et" kullanılır.
      return {
        menuVisible: true,
        healthy: true,
        provider: 'tsoft',
        canPushCustomer: true,
      };
    } catch (err) {
      this.logger.warn(`T-Soft durum kontrolü başarısız: ${(err as Error)?.message ?? err}`);
      return {
        menuVisible: false,
        healthy: false,
        provider: null,
        canPushCustomer: false,
      };
    }
  }

  async testConnection(organizationId: string) {
    this.statusCache.delete(organizationId);
    this.tsoftApi.clearTokenCache(organizationId);
    this.tsoftApi.clearRateLimitBlock(organizationId);
    await this.tsoftApi.getBearerToken(organizationId);
    this.statusCache.delete(organizationId);
    return { ok: true };
  }

  /** T-Soft giriş teşhisi (token yazılmaz; yine de istek limitine girer) */
  diagnoseTsoft(organizationId: string) {
    return this.tsoftApi.diagnoseLogin(organizationId);
  }

  async listProducts(organizationId: string, page: number, limit: number) {
    return this.tsoftApi.listProducts(organizationId, page, limit);
  }

  async listOrders(organizationId: string, page: number, limit: number) {
    return this.tsoftApi.listOrders(organizationId, page, limit);
  }

  /**
   * T-Soft müşterilerini çeker; CRM kişileriyle telefon eşleşmesi olanlara metadata yazar.
   */
  async syncTsoftCustomers(organizationId: string) {
    const customers = await this.tsoftApi.fetchAllCustomers(organizationId);
    const phoneToExternal = new Map<string, string>();

    for (const c of customers) {
      const mobile = (c.mobilePhone as string) || (c.customerPhone as string) || '';
      const key = normalizeTsoftPhone(mobile);
      if (!key) continue;
      const id = c.id != null ? String(c.id) : '';
      if (id) phoneToExternal.set(key, id);
    }

    const contacts = await this.prisma.contact.findMany({
      where: { organizationId },
      select: { id: true, phone: true, metadata: true },
    });

    let matched = 0;
    for (const contact of contacts) {
      const key = normalizeComparablePhone(contact.phone);
      const externalId = phoneToExternal.get(key);
      if (!externalId) continue;

      const prev =
        contact.metadata && typeof contact.metadata === 'object'
          ? (contact.metadata as Record<string, unknown>)
          : {};
      const next = {
        ...prev,
        ecommerce: {
          provider: 'tsoft',
          externalId,
          label: TSOFT_LABEL,
          syncedAt: new Date().toISOString(),
        },
      };

      await this.prisma.contact.update({
        where: { id: contact.id },
        data: { metadata: next as object },
      });
      matched++;
    }

    return {
      matched,
      tsoftCustomerCount: customers.length,
      crmContactCount: contacts.length,
    };
  }

  private mergeEcommerceMeta(
    existing: unknown,
    ecommerce: { provider: string; externalId: string; label: string },
  ) {
    const prev = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {};
    return {
      ...prev,
      ecommerce: {
        provider: ecommerce.provider,
        externalId: ecommerce.externalId,
        label: ecommerce.label,
        syncedAt: new Date().toISOString(),
      },
    };
  }

  private extractCreatedCustomerId(res: unknown): string {
    const r = res as Record<string, unknown>;
    const d = r?.data as Record<string, unknown> | undefined;
    const inner = d?.data as Record<string, unknown> | undefined;
    const id = (inner?.id ?? d?.id ?? r?.id) as string | number | undefined;
    if (id == null || id === '') {
      throw new BadRequestException('T-Soft yanıtında müşteri ID bulunamadı');
    }
    return String(id);
  }

  async createTsoftCustomerFromContact(
    organizationId: string,
    contactId: string,
    dto: {
      email: string;
      password: string;
      name: string;
      surname: string;
      address?: string;
      countryCode?: string;
      cityCode?: string;
      districtCode?: string;
      provinceCode?: string;
      townCode?: string;
      company?: string;
    },
  ) {
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) throw new NotFoundException('Kişi bulunamadı');
    if (contact.organizationId !== organizationId) {
      throw new BadRequestException('Bu kişi organizasyonunuza ait değil');
    }

    const mobilePhone = formatPhoneForTsoft(contact.phone);
    if (!mobilePhone || mobilePhone.length < 8) {
      throw new BadRequestException('Geçerli bir cep telefonu numarası bulunamadı');
    }

    const meta = contact.metadata as Record<string, unknown> | null;
    const ec = meta?.ecommerce as Record<string, unknown> | undefined;
    if (ec?.provider === 'tsoft' && ec?.externalId) {
      throw new BadRequestException('Bu kişi zaten T-Soft site müşterisi olarak işaretli');
    }

    const payload: CreateTsoftSiteCustomerPayload = {
      name: dto.name.trim(),
      surname: dto.surname.trim(),
      email: dto.email.trim(),
      password: dto.password,
      mobilePhone,
      company: dto.company?.trim() || undefined,
      address: dto.address?.trim() || undefined,
      countryCode: dto.countryCode?.trim() || 'TR',
      cityCode: dto.cityCode?.trim() || undefined,
      districtCode: dto.districtCode?.trim() || undefined,
      provinceCode: dto.provinceCode?.trim() || undefined,
      townCode: dto.townCode?.trim() || undefined,
      notification: true,
      smsNotification: true,
    };

    const res = await this.tsoftApi.createCustomer(organizationId, payload);
    const externalId = this.extractCreatedCustomerId(res);

    const nextMeta = this.mergeEcommerceMeta(contact.metadata, {
      provider: 'tsoft',
      externalId,
      label: TSOFT_LABEL,
    });

    await this.prisma.contact.update({
      where: { id: contactId },
      data: {
        metadata: nextMeta as object,
        email: contact.email || dto.email.trim(),
        name: contact.name || dto.name.trim(),
        surname: contact.surname || dto.surname.trim(),
      },
    });

    return { ok: true, externalId, label: TSOFT_LABEL };
  }
}
