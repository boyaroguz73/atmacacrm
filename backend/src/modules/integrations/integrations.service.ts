import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getPlanConfig } from '../billing/plan-config';
import { INTEGRATION_CATALOG, getIntegration, CATEGORY_LABELS, IntegrationCategory } from './integration-catalog';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Tek firma: önce sorgu/JWT org, yoksa veritabanındaki ilk organizasyon (OrgIntegration FK için gerekli).
   */
  async resolveOrganizationId(
    user: { role?: string; organizationId?: string | null },
    queryOrganizationId?: string,
  ): Promise<string> {
    const q = queryOrganizationId?.trim();
    if (q) {
      const exists = await this.prisma.organization.findUnique({
        where: { id: q },
        select: { id: true },
      });
      if (exists) return exists.id;
      this.logger.warn(`resolveOrganizationId: query organizationId geçersiz, yok sayılıyor (${q})`);
    }
    if (user.organizationId) {
      const stillThere = await this.prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { id: true },
      });
      if (stillThere) return stillThere.id;
      this.logger.warn(
        `Kullanıcı organizationId geçersiz veya silinmiş (userId ilişkili), findFirst deneniyor`,
      );
    }
    const first = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (first) {
      this.logger.debug(`Entegrasyonlar org çözüldü: ilk organizasyon ${first.id}`);
      return first.id;
    }
    this.logger.error('Entegrasyonlar: veritabanında hiç Organization yok (seed gerekli)');
    throw new BadRequestException(
      'Veritabanında organizasyon kaydı yok. `npx prisma db seed` veya en az bir Organization oluşturun.',
    );
  }

  async getCatalog(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });
    if (!org) {
      this.logger.warn(`getCatalog: organizasyon bulunamadı id=${organizationId}`);
      throw new NotFoundException('Organizasyon bulunamadı');
    }

    const planConfig = getPlanConfig(org.plan);
    const flags = planConfig.featureFlags as Record<string, boolean>;

    let orgIntegrations;
    try {
      orgIntegrations = await this.prisma.orgIntegration.findMany({
        where: { organizationId },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`orgIntegration.findMany başarısız: ${msg}`);
      if (msg.includes('org_integrations') || msg.includes('does not exist') || msg.includes('relation')) {
        throw new ServiceUnavailableException(
          'org_integrations tablosu eksik veya güncel değil. Sunucuda: git pull, ardından ' +
            '`docker compose build --no-cache backend && docker compose up -d` (imajda yeni migration olmalı), ' +
            'sonra konteyner içinde `npx prisma migrate deploy`.',
        );
      }
      throw e;
    }
    const orgMap = new Map(orgIntegrations.map((i) => [i.integrationKey, i]));

    const categories: Record<IntegrationCategory, any[]> = {
      messaging: [],
      ecommerce: [],
      ai: [],
    };

    for (const def of INTEGRATION_CATALOG) {
      const bucket = categories[def.category];
      if (!bucket) {
        this.logger.error(`Entegrasyon kataloğunda bilinmeyen kategori: ${def.category} (${def.key})`);
        continue;
      }
      const includedInPlan = !!flags[def.featureFlag];
      const orgInt = orgMap.get(def.key);
      const purchased = !!orgInt?.purchasedAt;
      const isEnabled = !!orgInt?.isEnabled;
      const available = includedInPlan || purchased;

      bucket.push({
        key: def.key,
        name: def.name,
        description: def.description,
        category: def.category,
        icon: def.icon,
        includedInPlan,
        purchased,
        isEnabled,
        available,
        addonPrice: def.addonPrice,
        comingSoon: def.comingSoon || false,
        config: orgInt?.config || null,
      });
    }

    return {
      plan: org.plan,
      categories: Object.entries(categories).map(([key, items]) => ({
        key,
        label: CATEGORY_LABELS[key as IntegrationCategory],
        integrations: items,
      })),
    };
  }

  async toggleIntegration(organizationId: string, integrationKey: string, enable: boolean) {
    const def = getIntegration(integrationKey);
    if (!def) throw new NotFoundException('Entegrasyon bulunamadı');
    if (def.comingSoon) throw new BadRequestException('Bu entegrasyon yakında kullanıma açılacak');

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');

    const flags = getPlanConfig(org.plan).featureFlags as Record<string, boolean>;
    const includedInPlan = !!flags[def.featureFlag];

    const existing = await this.prisma.orgIntegration.findUnique({
      where: { organizationId_integrationKey: { organizationId, integrationKey } },
    });

    if (enable && !includedInPlan && !existing?.purchasedAt) {
      throw new ForbiddenException(
        'Bu entegrasyon paketinize dahil değil. Lütfen satın alın veya paketinizi yükseltin.',
      );
    }

    const result = await this.prisma.orgIntegration.upsert({
      where: { organizationId_integrationKey: { organizationId, integrationKey } },
      create: {
        organizationId,
        integrationKey,
        isEnabled: enable,
        ...(includedInPlan ? { purchasedAt: new Date() } : {}),
      },
      update: { isEnabled: enable },
    });

    this.logger.log(`Entegrasyon ${enable ? 'açıldı' : 'kapatıldı'}: ${integrationKey} (org: ${organizationId})`);
    return result;
  }

  async updateConfig(organizationId: string, integrationKey: string, config: any) {
    const def = getIntegration(integrationKey);
    if (!def) throw new NotFoundException('Entegrasyon bulunamadı');

    const existing = await this.prisma.orgIntegration.findUnique({
      where: { organizationId_integrationKey: { organizationId, integrationKey } },
    });
    if (!existing) throw new NotFoundException('Entegrasyon henüz etkinleştirilmemiş');

    return this.prisma.orgIntegration.update({
      where: { id: existing.id },
      data: { config },
    });
  }

  async saveConfig(organizationId: string, integrationKey: string, config: any) {
    const def = getIntegration(integrationKey);
    if (!def) throw new NotFoundException('Entegrasyon bulunamadı');

    const existing = await this.prisma.orgIntegration.findUnique({
      where: { organizationId_integrationKey: { organizationId, integrationKey } },
    });
    const prev = (existing?.config as Record<string, unknown>) || {};
    const next = { ...prev, ...config } as Record<string, unknown>;
    if (
      integrationKey === 'tsoft' &&
      (!config?.apiPassword || String(config.apiPassword).trim() === '') &&
      prev.apiPassword
    ) {
      next.apiPassword = prev.apiPassword;
    }

    if (integrationKey === 'tsoft' && config && 'pathPrefix' in config) {
      const p = (config as { pathPrefix?: unknown }).pathPrefix;
      if (p == null || p === '' || p === false) {
        delete next.pathPrefix;
      }
    }

    const configJson = JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue;
    return this.prisma.orgIntegration.upsert({
      where: { organizationId_integrationKey: { organizationId, integrationKey } },
      create: { organizationId, integrationKey, isEnabled: true, config: configJson },
      update: { config: configJson },
    });
  }

  async purchaseAddon(organizationId: string, integrationKey: string) {
    const def = getIntegration(integrationKey);
    if (!def) throw new NotFoundException('Entegrasyon bulunamadı');
    if (def.comingSoon) throw new BadRequestException('Bu entegrasyon yakında kullanıma açılacak');
    if (def.addonPrice === 0) throw new BadRequestException('Bu entegrasyon ücretsizdir');

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');

    const flags = getPlanConfig(org.plan).featureFlags as Record<string, boolean>;
    if (flags[def.featureFlag]) {
      throw new BadRequestException('Bu entegrasyon zaten paketinize dahil');
    }

    const result = await this.prisma.orgIntegration.upsert({
      where: { organizationId_integrationKey: { organizationId, integrationKey } },
      create: {
        organizationId,
        integrationKey,
        isEnabled: true,
        purchasedAt: new Date(),
      },
      update: {
        purchasedAt: new Date(),
        isEnabled: true,
      },
    });

    await this.prisma.invoice.create({
      data: {
        organizationId,
        amount: def.addonPrice,
        status: 'paid',
        description: `${def.name} Entegrasyon Eklentisi`,
        paidAt: new Date(),
      },
    });

    this.logger.log(`Eklenti satın alındı: ${integrationKey} (${def.addonPrice} TRY) org: ${organizationId}`);
    return { ...result, addonPrice: def.addonPrice };
  }
}
