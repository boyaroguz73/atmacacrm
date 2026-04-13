import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
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

  @Get()
  async getCatalog(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Query('organizationId') organizationId?: string,
  ) {
    const orgId = await this.integrationsService.resolveOrganizationId(
      user,
      organizationId,
    );
    return this.integrationsService.getCatalog(orgId);
  }

  @Post(':key/toggle')
  async toggleIntegration(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Query('organizationId') organizationId: string | undefined,
    @Param('key') key: string,
    @Body('enable') enable: boolean,
  ) {
    const orgId = await this.integrationsService.resolveOrganizationId(
      user,
      organizationId,
    );
    return this.integrationsService.toggleIntegration(orgId, key, enable);
  }

  @Patch(':key/config')
  async updateConfig(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Query('organizationId') organizationId: string | undefined,
    @Param('key') key: string,
    @Body('config') config: any,
  ) {
    const orgId = await this.integrationsService.resolveOrganizationId(
      user,
      organizationId,
    );
    return this.integrationsService.updateConfig(orgId, key, config);
  }

  @Post(':key/config')
  async saveConfig(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Query('organizationId') organizationId: string | undefined,
    @Param('key') key: string,
    @Body() body: any,
  ) {
    const orgId = await this.integrationsService.resolveOrganizationId(
      user,
      organizationId,
    );
    return this.integrationsService.saveConfig(orgId, key, body);
  }

  @Post(':key/purchase')
  async purchaseAddon(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Query('organizationId') organizationId: string | undefined,
    @Param('key') key: string,
  ) {
    const orgId = await this.integrationsService.resolveOrganizationId(
      user,
      organizationId,
    );
    return this.integrationsService.purchaseAddon(orgId, key);
  }
}
