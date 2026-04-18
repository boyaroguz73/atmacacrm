import {
  Controller,
  Get,
  Post,
  Put,
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
import { SaveTsoftAutoReplyDto } from './dto/tsoft-auto-reply.dto';
import { CreateTsoftOrderDto } from './dto/create-tsoft-order.dto';

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

  @Get('status')
  async getStatus(@CurrentUser() user: { role?: string; organizationId?: string | null }) {
    if (user.role === 'SUPERADMIN' || !user.organizationId) {
      return { menuVisible: false, healthy: false, provider: null as string | null, canPushCustomer: false };
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
  syncTsoftOrders(@CurrentUser() user: { role?: string; organizationId?: string | null }) {
    return this.ecommerceService.syncTsoftOrders(this.orgId(user));
  }

  @Get('tsoft/products')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'AGENT')
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

  /** Canlı T-Soft sipariş listesi (ham API) */
  @Get('tsoft/orders/live')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  listOrdersLive(
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

  /** DB'den sync edilmiş sipariş listesi */
  @Get('tsoft/synced-orders')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'AGENT')
  getSyncedOrders(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
  ) {
    return this.ecommerceService.getSyncedOrders(
      this.orgId(user),
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(limit, 10) || 20)),
      search,
    );
  }

  /** Tek sipariş detayı */
  @Get('tsoft/synced-orders/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'AGENT')
  getSyncedOrderById(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Param('id') id: string,
  ) {
    return this.ecommerceService.getSyncedOrderById(this.orgId(user), id);
  }

  /** T-Soft'ta yeni sipariş oluştur */
  @Post('tsoft/orders')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'AGENT')
  createOrder(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Body() dto: CreateTsoftOrderDto,
  ) {
    return this.ecommerceService.createTsoftOrder(this.orgId(user), dto);
  }

  /** Otomatik yanıt şablonlarını getir */
  @Get('tsoft/auto-reply')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getAutoReplies(@CurrentUser() user: { role?: string; organizationId?: string | null }) {
    return this.ecommerceService.getAutoReplies(this.orgId(user));
  }

  /** Otomatik yanıt şablonu kaydet / güncelle */
  @Put('tsoft/auto-reply')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  saveAutoReply(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Body() dto: SaveTsoftAutoReplyDto,
  ) {
    return this.ecommerceService.saveAutoReply(this.orgId(user), dto.eventType, dto.template, dto.isActive);
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
