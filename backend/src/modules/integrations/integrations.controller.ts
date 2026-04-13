import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('integrations')
export class IntegrationsController {
  constructor(private integrationsService: IntegrationsService) {}

  private getOrgId(user: { organizationId?: string | null }): string {
    if (!user.organizationId) throw new BadRequestException('Organizasyon bulunamadı');
    return user.organizationId;
  }

  @Get()
  getCatalog(@CurrentUser() user: { organizationId?: string | null }) {
    return this.integrationsService.getCatalog(this.getOrgId(user));
  }

  @Post(':key/toggle')
  toggleIntegration(
    @CurrentUser() user: { organizationId?: string | null },
    @Param('key') key: string,
    @Body('enable') enable: boolean,
  ) {
    return this.integrationsService.toggleIntegration(this.getOrgId(user), key, enable);
  }

  @Patch(':key/config')
  updateConfig(
    @CurrentUser() user: { organizationId?: string | null },
    @Param('key') key: string,
    @Body('config') config: any,
  ) {
    return this.integrationsService.updateConfig(this.getOrgId(user), key, config);
  }

  @Post(':key/config')
  saveConfig(
    @CurrentUser() user: { organizationId?: string | null },
    @Param('key') key: string,
    @Body() body: any,
  ) {
    return this.integrationsService.saveConfig(this.getOrgId(user), key, body);
  }

  @Post(':key/purchase')
  purchaseAddon(
    @CurrentUser() user: { organizationId?: string | null },
    @Param('key') key: string,
  ) {
    return this.integrationsService.purchaseAddon(this.getOrgId(user), key);
  }
}
