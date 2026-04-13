import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlanType } from '@prisma/client';

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('billing')
export class BillingController {
  constructor(private billingService: BillingService) {}

  @Get('plans')
  getPlans() {
    return this.billingService.getPlans();
  }

  @Get('subscription')
  @Roles('ADMIN')
  async getSubscription(@Req() req: any) {
    const orgId = req.user.organizationId;
    if (!orgId) throw new BadRequestException('Organizasyon bulunamadı');
    return this.billingService.getSubscription(orgId);
  }

  @Get('invoices')
  @Roles('ADMIN')
  async getInvoices(@Req() req: any) {
    const orgId = req.user.organizationId;
    if (!orgId) throw new BadRequestException('Organizasyon bulunamadı');
    return this.billingService.getInvoices(orgId);
  }

  @Post('subscribe')
  @Roles('ADMIN')
  async subscribe(
    @Req() req: any,
    @Body()
    body: {
      plan: string;
      card: {
        cardHolderName: string;
        cardNumber: string;
        expireMonth: string;
        expireYear: string;
        cvc: string;
      };
      buyer: {
        name: string;
        surname: string;
        email: string;
        phone: string;
        identityNumber: string;
        address: string;
        city: string;
      };
    },
  ) {
    const orgId = req.user.organizationId;
    if (!orgId) throw new BadRequestException('Organizasyon bulunamadı');

    return this.billingService.initializePayment(
      orgId,
      body.plan,
      body.card,
      body.buyer,
    );
  }

  @Post('cancel')
  @Roles('ADMIN')
  async cancelSubscription(@Req() req: any) {
    const orgId = req.user.organizationId;
    if (!orgId) throw new BadRequestException('Organizasyon bulunamadı');
    return this.billingService.cancelSubscription(orgId);
  }

  // SuperAdmin endpoints
  @Get('revenue')
  @Roles('SUPERADMIN')
  getRevenue() {
    return this.billingService.getRevenueStats();
  }

  @Get('plan-configs')
  @Roles('SUPERADMIN')
  getPlanConfigs() {
    return this.billingService.getPlanConfigs();
  }

  @Patch('plan-configs/:plan')
  @Roles('SUPERADMIN')
  updatePlanConfig(
    @Param('plan') plan: string,
    @Body() body: any,
  ) {
    return this.billingService.updatePlanConfig(plan, body);
  }

  @Post('assign')
  @Roles('SUPERADMIN')
  assignPlan(@Req() req: any, @Body() body: Record<string, unknown>) {
    return this.billingService.assignPlan({
      organizationId: String(body.organizationId ?? ''),
      plan: String(body.plan ?? 'FREE').toUpperCase() as PlanType,
      durationDays: Number(body.durationDays),
      notes: body.notes != null ? String(body.notes) : undefined,
      assignedById: req.user.id,
    });
  }
}
