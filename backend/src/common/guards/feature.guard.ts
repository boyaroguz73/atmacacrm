import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { getPlanConfig } from '../../modules/billing/plan-config';

export const FEATURES_KEY = 'features';
export const RequireFeatures = (...features: string[]) =>
  (target: any, key?: string, descriptor?: any) => {
    Reflect.defineMetadata(FEATURES_KEY, features, descriptor?.value ?? target);
    return descriptor ?? target;
  };

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeatures = this.reflector.get<string[]>(
      FEATURES_KEY,
      context.getHandler(),
    );
    if (!requiredFeatures || requiredFeatures.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.organizationId) return true;
    if (user.role === 'SUPERADMIN') return true;

    const org = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { plan: true },
    });

    if (!org) return true;

    const planConfig = getPlanConfig(org.plan);
    const flags = planConfig.featureFlags as Record<string, boolean>;

    for (const feature of requiredFeatures) {
      if (!flags[feature]) {
        throw new ForbiddenException(
          `Bu özellik mevcut planınızda kullanılamaz. Lütfen planınızı yükseltin.`,
        );
      }
    }

    return true;
  }
}
