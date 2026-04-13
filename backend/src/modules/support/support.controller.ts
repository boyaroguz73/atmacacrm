import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TicketStatus, TicketPriority } from '@prisma/client';

@ApiTags('Support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('support')
export class SupportController {
  constructor(private supportService: SupportService) {}

  /** Statik path; tickets/:id ile çakışmaması için tickets/stats kullanılmaz */
  @Get('stats/tickets')
  @Roles('SUPERADMIN')
  getTicketStats() {
    return this.supportService.getTicketStats();
  }

  @Post('tickets')
  @Roles('ADMIN')
  async createTicket(
    @Req() req: any,
    @Body()
    body: {
      subject: string;
      description: string;
      priority?: TicketPriority;
      category?: string;
    },
  ) {
    const orgId = req.user.organizationId;
    if (!orgId) throw new BadRequestException('Organizasyon bulunamadı');

    return this.supportService.createTicket({
      organizationId: orgId,
      createdById: req.user.id,
      subject: body.subject,
      description: body.description,
      priority: body.priority,
      category: body.category,
    });
  }

  @Get('tickets')
  @Roles('ADMIN')
  async getTickets(
    @Req() req: any,
    @Query('status') status?: TicketStatus,
    @Query('priority') priority?: TicketPriority,
  ) {
    const filters: any = {};
    if (status) filters.status = status;
    if (priority) filters.priority = priority;

    if (req.user.role !== 'SUPERADMIN') {
      if (!req.user.organizationId) {
        throw new ForbiddenException('Organizasyon bulunamadı');
      }
      filters.organizationId = req.user.organizationId;
    }

    return this.supportService.findAll(filters);
  }

  @Get('tickets/:id')
  @Roles('ADMIN')
  async getTicket(@Param('id') id: string, @Req() req: any) {
    const ticket = await this.supportService.findById(id);

    if (req.user.role !== 'SUPERADMIN') {
      if (!req.user.organizationId || ticket.organizationId !== req.user.organizationId) {
        throw new ForbiddenException('Bu talebe erişim yetkiniz yok');
      }
    }

    return ticket;
  }

  @Patch('tickets/:id')
  @Roles('SUPERADMIN')
  async updateTicket(
    @Param('id') id: string,
    @Body()
    body: {
      status?: TicketStatus;
      priority?: TicketPriority;
      assignedToId?: string | null;
      category?: string;
    },
  ) {
    return this.supportService.updateTicket(id, body);
  }

  @Post('tickets/:id/messages')
  @Roles('ADMIN')
  async addMessage(
    @Param('id') id: string,
    @Body('body') body: string,
    @Req() req: any,
  ) {
    if (!body?.trim()) throw new BadRequestException('Mesaj boş olamaz');

    const ticket = await this.supportService.findById(id);
    if (req.user.role !== 'SUPERADMIN') {
      if (!req.user.organizationId || ticket.organizationId !== req.user.organizationId) {
        throw new ForbiddenException('Bu talebe erişim yetkiniz yok');
      }
    }

    return this.supportService.addMessage(id, req.user.id, body);
  }
}
