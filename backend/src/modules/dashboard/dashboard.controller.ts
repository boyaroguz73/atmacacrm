import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { requireOrgId } from '../../common/org-session-scope';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('overview')
  getOverview(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dashboardService.getOverview(requireOrgId(user), from, to);
  }

  @Get('agent-performance')
  getAgentPerformance(@CurrentUser() user: { role: string; organizationId?: string }) {
    return this.dashboardService.getAgentPerformance(requireOrgId(user));
  }

  @Get('message-stats')
  getMessageStats(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Query('days') days?: string,
  ) {
    return this.dashboardService.getMessageStats(
      days ? parseInt(days) : 7,
      requireOrgId(user),
    );
  }
}
