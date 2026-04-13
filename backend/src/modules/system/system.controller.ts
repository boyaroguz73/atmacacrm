import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SystemService } from './system.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('System')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('system')
export class SystemController {
  constructor(private systemService: SystemService) {}

  @Get('metrics')
  @Roles('SUPERADMIN')
  getMetrics() {
    return this.systemService.getMetrics();
  }
}
