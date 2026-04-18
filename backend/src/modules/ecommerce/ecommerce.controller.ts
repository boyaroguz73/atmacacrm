import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EcommerceService } from './ecommerce.service';
import { CreateTsoftCustomerDto } from './dto/create-tsoft-customer.dto';

@ApiTags('E-Commerce')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ecommerce')
export class EcommerceController {
  constructor(private ecommerceService: EcommerceService) {}

  private orgId(user: { role?: string; organizationId?: string | null }): string {
    if (user.role === 'SUPERADMIN') {
      throw new BadRequestException('Bu işlem organizasyon kullanıcıları içindir');
    }
    if (!user.organizationId) {
      throw new BadRequestException('Organizasyon bulunamadı');
    }
    return user.organizationId;
  }

  /** Kenar çubuğu ve sohbet paneli: entegrasyon görünürlüğü */
  @Get('status')
  async getStatus(@CurrentUser() user: { role?: string; organizationId?: string | null }) {
    if (user.role === 'SUPERADMIN' || !user.organizationId) {
      return {
        menuVisible: false,
        healthy: false,
        provider: null as string | null,
        canPushCustomer: false,
      };
    }
    return await this.ecommerceService.getStatus(user.organizationId);
  }

  @Post('tsoft/test')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  testTsoft(@CurrentUser() user: { role?: string; organizationId?: string | null }) {
    return this.ecommerceService.testConnection(this.orgId(user));
  }

  @Post('tsoft/diagnose')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  diagnoseTsoft(@CurrentUser() user: { role?: string; organizationId?: string | null }) {
    return this.ecommerceService.diagnoseTsoft(this.orgId(user));
  }

  @Post('tsoft/sync-customers')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  syncTsoftCustomers(@CurrentUser() user: { role?: string; organizationId?: string | null }) {
    return this.ecommerceService.syncTsoftCustomers(this.orgId(user));
  }

  @Post('tsoft/sync-orders')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  syncTsoftOrders(@CurrentUser() user: { id: string; role?: string; organizationId?: string | null }) {
    return this.ecommerceService.syncTsoftOrders(this.orgId(user), user.id);
  }

  @Get('tsoft/products')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  listProducts(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.ecommerceService.listProducts(
      this.orgId(user),
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
    );
  }

  @Get('tsoft/orders')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  listOrders(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.ecommerceService.listOrders(
      this.orgId(user),
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
    );
  }

  @Post('tsoft/contacts/:contactId/customer')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'AGENT')
  createTsoftCustomer(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Param('contactId') contactId: string,
    @Body() dto: CreateTsoftCustomerDto,
  ) {
    return this.ecommerceService.createTsoftCustomerFromContact(this.orgId(user), contactId, dto);
  }
}
