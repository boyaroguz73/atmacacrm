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
@Roles('ADMIN')
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

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
