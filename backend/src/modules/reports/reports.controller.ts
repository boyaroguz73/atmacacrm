import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { requireOrgId } from '../../common/org-session-scope';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN')
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('dashboard')
  getDashboard(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getExecutiveDashboard(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      requireOrgId(req.user),
    );
  }

  @Get('messages/timeseries')
  getMessageTimeseries(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getMessageTimeseries(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      requireOrgId(req.user),
    );
  }

  @Get('cash/timeseries')
  getCashTimeseries(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getCashTimeseries(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('sales/timeseries')
  getSalesTimeseries(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: string,
  ) {
    const g = granularity === 'month' || granularity === 'week' ? granularity : 'day';
    return this.reportsService.getSalesTimeseries(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      requireOrgId(req.user),
      g,
    );
  }

  @Get('sales/top-customers')
  getTopCustomers(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reportsService.getTopCustomers(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      requireOrgId(req.user),
      limit ? parseInt(limit, 10) : 10,
    );
  }

  @Get('leads/funnel')
  getLeadFunnel(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getLeadFunnel(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      requireOrgId(req.user),
    );
  }

  @Get('sales/top-categories')
  getTopCategories(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reportsService.getTopProductCategories(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      requireOrgId(req.user),
      limit ? parseInt(limit, 10) : 12,
    );
  }

  @Get('sales/products')
  getSoldProducts(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reportsService.getSoldProducts(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      requireOrgId(req.user),
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 30,
    );
  }

  @Get('invoices')
  getInvoicesReport(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reportsService.getInvoicesReport(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      requireOrgId(req.user),
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 40,
    );
  }

  @Get('contacts/engaged')
  getEngagedContacts(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reportsService.getEngagedContacts(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      requireOrgId(req.user),
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 40,
    );
  }

  @Get('agents')
  getAgentReport(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getAgentDetailedReport(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      requireOrgId(req.user),
    );
  }

  @Get('summary')
  getSummary(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getSummary(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      requireOrgId(req.user),
    );
  }
}
