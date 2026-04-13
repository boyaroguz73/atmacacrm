import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getPlanConfig } from '../billing/plan-config';
import { INTEGRATION_CATALOG, getIntegration, CATEGORY_LABELS, IntegrationCategory } from './integration-catalog';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * ADMIN: JWT’deki organizationId.
   * SUPERADMIN + boş JWT org: `?organizationId=` veya veritabanındaki ilk organizasyon (tek kiracılı kurulumlar için).
   */
  async resolveOrganizationId(
    user: { role?: string; organizationId?: string | null },
    queryOrganizationId?: string,
  ): Promise<string> {
    if (user.organizationId) {
      return user.organizationId;
    }
    const q = queryOrganizationId?.trim();
    if (q) {
      return q;
    }
    if (user.role === 'SUPERADMIN') {
      const first = await this.prisma.organization.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (first) {
        this.logger.warn(
          `Entegrasyonlar: SUPERADMIN için organizationId yok; ilk organizasyon kullanılıyor (${first.id}).`,
        );
        return first.id;
      }
    }
    if (user.role === 'ADMIN') {
      const count = await this.prisma.organization.count();
      if (count === 1) {
        const only = await this.prisma.organization.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (only) {
          this.logger.warn(
            `Entegrasyonlar: ADMIN kullanıcıda organizationId yok; tek organizasyon kullanılıyor (${only.id}).`,
          );
          return only.id;
        }
      }
      throw new BadRequestException(
        'Hesabınızda organizasyon atanmamış. Süper yöneticiden kullanıcıyı bir organizasyona bağlamasını isteyin veya URL\'ye ?organizationId= ekleyin.',
      );
    }
    throw new BadRequestException(
      'Organizasyon bulunamadı. URL\'ye ?organizationId= ekleyin veya en az bir organizasyon oluşturun.',
    );
  }

  async getCatalog(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });
    if (!org) throw new NotFoundException('Organizasyon bulunamadı');

    const planConfig = getPlanConfig(org.plan);
    const flags = planConfig.featureFlags as Record<string, boolean>;

    const orgIntegrations = await this.prisma.orgIntegration.findMany({
      where: { organizationId },
    });
    const orgMap = new Map(orgIntegrations.map((i) => [i.integrationKey, i]));

    const categories: Record<IntegrationCategory, any[]> = {
      messaging: [],
      ecommerce: [],
      ai: [],
    };

    for (const def of INTEGRATION_CATALOG) {
      const includedInPlan = !!flags[def.featureFlag];
      const orgInt = orgMap.get(def.key);
      const purchased = !!orgInt?.purchasedAt;
      const isEnabled = !!orgInt?.isEnabled;
      const available = includedInPlan || purchased;

      categories[def.category].push({
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
