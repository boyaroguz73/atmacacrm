import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AutoReplyService, FlowStep } from './auto-reply.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { requireOrgId, assertBelongsToOrg } from '../../common/org-session-scope';

@ApiTags('AutoReply')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('auto-reply')
export class AutoReplyController {
  constructor(private autoReplyService: AutoReplyService) {}

  @Get()
  findAll(@CurrentUser() user: { role: string; organizationId?: string }) {
    return this.autoReplyService.findAll(requireOrgId(user));
  }

  @Get(':id')
  async findById(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Param('id') id: string,
  ) {
    const flow = await this.autoReplyService.findById(id);
    this.assertFlowOrg(flow, user);
    return flow;
  }

  @Post()
  create(
    @Body()
    body: {
      name: string;
      description?: string;
      trigger: string;
      conditions?: any;
      steps: FlowStep[];
      activeFrom?: string;
    },
    @CurrentUser() user: { id: string; role: string; organizationId?: string },
  ) {
    return this.autoReplyService.create(body, user.id, user.organizationId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      trigger?: string;
      conditions?: any;
      steps?: FlowStep[];
      isActive?: boolean;
      activeFrom?: string | null;
    },
    @CurrentUser() user: { id: string; role: string; organizationId?: string },
  ) {
    const flow = await this.autoReplyService.findById(id);
    this.assertFlowOrg(flow, user);
    return this.autoReplyService.update(id, body, user.id);
  }

  @Patch(':id/toggle')
  async toggleActive(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string; organizationId?: string },
  ) {
    const flow = await this.autoReplyService.findById(id);
    this.assertFlowOrg(flow, user);
    return this.autoReplyService.toggleActive(id, user.id);
  }

  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string; organizationId?: string },
  ) {
    const flow = await this.autoReplyService.findById(id);
    this.assertFlowOrg(flow, user);
    return this.autoReplyService.delete(id, user.id);
  }

  private assertFlowOrg(
    flow: { organizationId?: string | null },
    user: { role: string; organizationId?: string },
  ) {
    assertBelongsToOrg(user, flow.organizationId, 'akışa');
  }
}
