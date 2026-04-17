import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { requireOrgId } from '../../common/org-session-scope';

@ApiTags('AuditLog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('audit-logs')
export class AuditLogController {
  constructor(private auditLogService: AuditLogService) {}

  @Get()
  findAll(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('entity') entity?: string,
    @Query('action') action?: string,
    @Query('search') search?: string,
    @Query('scope') scope?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.auditLogService.findAll({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      userId,
      entity,
      action,
      search,
      scope,
      startDate,
      endDate,
      organizationId: requireOrgId(user),
    });
  }

  @Get('entities')
  getEntities(@CurrentUser() user: { role: string; organizationId?: string }) {
    return this.auditLogService.getEntities(requireOrgId(user));
  }

  @Get('actions')
  getActions(@CurrentUser() user: { role: string; organizationId?: string }) {
    return this.auditLogService.getActions(requireOrgId(user));
  }
}
