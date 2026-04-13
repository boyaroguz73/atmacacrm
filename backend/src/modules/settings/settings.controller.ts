import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('system-settings')
export class SettingsController {
  constructor(
    private settingsService: SettingsService,
    private auditLog: AuditLogService,
  ) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getAll() {
    return this.settingsService.getAll();
  }

  @Patch()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async updateSetting(
    @Body() body: { key: string; value: string },
    @Req() req: any,
  ) {
    const result = await this.settingsService.set(body.key, body.value);

    await this.auditLog.log({
      userId: req.user.id,
      organizationId: req.user.organizationId ?? undefined,
      action: 'UPDATE',
      entity: 'SystemSetting',
      details: { key: body.key, value: body.value },
    });

    return result;
  }
}
