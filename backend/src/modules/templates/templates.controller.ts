import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { requireOrgId, assertBelongsToOrg } from '../../common/org-session-scope';

@ApiTags('Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private templatesService: TemplatesService) {}

  @Get()
  async findAll(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Query('category') category?: string,
    @Query('active') active?: string,
  ) {
    const isActive = active === 'true' ? true : active === 'false' ? false : undefined;
    return this.templatesService.findAll({
      category,
      isActive,
      organizationId: requireOrgId(user),
    });
  }

  @Get('categories')
  getCategories(@CurrentUser() user: { role: string; organizationId?: string }) {
    return this.templatesService.getCategories(requireOrgId(user));
  }

  @Get(':id')
  async findById(
    @CurrentUser() _user: { role: string; organizationId?: string },
    @Param('id') id: string,
  ) {
    return this.templatesService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(
    @Body() body: { title: string; body: string; category?: string; shortcut?: string },
    @CurrentUser() user: { id: string; role: string; organizationId?: string },
  ) {
    return this.templatesService.create(body, user.id, requireOrgId(user));
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async update(
    @Param('id') id: string,
    @Body() body: { title?: string; body?: string; category?: string; shortcut?: string; isActive?: boolean },
    @CurrentUser() user: { id: string; role: string; organizationId?: string },
  ) {
    const template = await this.templatesService.findById(id);
    this.assertTemplateOrg(template, user);
    return this.templatesService.update(id, body, user.id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string; organizationId?: string },
  ) {
    const template = await this.templatesService.findById(id);
    this.assertTemplateOrg(template, user);
    return this.templatesService.delete(id, user.id);
  }

  private assertTemplateOrg(
    template: { organizationId?: string | null },
    user: { role: string; organizationId?: string },
  ) {
    assertBelongsToOrg(user, template.organizationId, 'şablona');
  }
}
