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
import { LeadsService } from './leads.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LeadStatus } from '@prisma/client';
import { requireOrgId, assertBelongsToOrg } from '../../common/org-session-scope';

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('leads')
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  @Get()
  findAll(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Query('status') status?: LeadStatus,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.leadsService.findAll({
      status,
      search,
      from,
      to,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      organizationId: requireOrgId(user),
    });
  }

  @Get('pipeline')
  getPipelineStats(@CurrentUser() user: { role: string; organizationId?: string }) {
    return this.leadsService.getPipelineStats(requireOrgId(user));
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { role: string; organizationId?: string },
  ) {
    const lead = await this.leadsService.findById(id);
    this.assertLeadOrg(user, lead);
    return lead;
  }

  @Post()
  create(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Body()
    body: {
      contactId: string;
      status?: LeadStatus;
      value?: number;
      source?: string;
      notes?: string;
    },
  ) {
    return this.leadsService.create(body, requireOrgId(user));
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: LeadStatus,
    @CurrentUser() user: { id: string; role: string; organizationId?: string },
  ) {
    const lead = await this.leadsService.findById(id);
    this.assertLeadOrg(user, lead);
    return this.leadsService.updateStatus(id, status, user.id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { value?: number; source?: string; notes?: string },
    @CurrentUser() user: { role: string; organizationId?: string },
  ) {
    const lead = await this.leadsService.findById(id);
    this.assertLeadOrg(user, lead);
    return this.leadsService.update(id, body);
  }

  private assertLeadOrg(
    user: { role: string; organizationId?: string },
    lead: { contact?: { organizationId?: string | null } | null } | null,
  ) {
    if (!lead) return;
    assertBelongsToOrg(user, lead.contact?.organizationId, 'lead veriye');
  }
}
