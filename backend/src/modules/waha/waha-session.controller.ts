import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  Body,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { WahaService, WahaAccessContext } from './waha.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('WhatsApp Sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sessions')
export class WahaSessionController {
  constructor(private wahaService: WahaService) {}

  private ctx(req: { user?: { role?: string; organizationId?: string | null } }): WahaAccessContext {
    return {
      role: req.user?.role ?? '',
      organizationId: req.user?.organizationId ?? null,
    };
  }

  @Get()
  async getAllSessions(@Req() req: any) {
    return this.wahaService.getAllSessionsMerged(this.ctx(req));
  }

  @Post('start')
  @Roles('ADMIN')
  async startSession(@Req() req: any, @Body('name') name: string) {
    return this.wahaService.startSession(name, this.ctx(req));
  }

  @Post('stop')
  @Roles('ADMIN')
  async stopSession(@Req() req: any, @Body('name') name: string) {
    return this.wahaService.stopSession(name, this.ctx(req));
  }

  @Post('sync')
  @Roles('ADMIN')
  async syncSessions(@Req() req: any) {
    await this.wahaService.syncSessions(this.ctx(req));
    return { message: 'Oturumlar senkronize edildi' };
  }

  @Get(':name/qr')
  @Roles('ADMIN')
  async getQrCode(@Req() req: any, @Param('name') name: string) {
    const qr = await this.wahaService.getQrCode(name, this.ctx(req));
    return { qr };
  }

  @Get(':name/status')
  @Roles('ADMIN')
  async getStatus(@Req() req: any, @Param('name') name: string) {
    return this.wahaService.getSessionStatus(name, this.ctx(req));
  }

  @Delete(':name')
  @Roles('ADMIN')
  async deleteSession(@Req() req: any, @Param('name') name: string) {
    return this.wahaService.deleteSession(name, this.ctx(req));
  }
}
