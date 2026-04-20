import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import {
  CreateTsoftCatalogDto,
  UpdateTsoftCatalogDto,
  DeleteSiteOrderDto,
  SetSiteOrderStatusDto,
  PushSalesOrderToTsoftDto,
  SetCrmLinkedSiteOrderStatusDto,
} from './dto/tsoft-catalog.dto';

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

  /** CRM siparişlerinden e-ticaret ekranında seçim listesi (organizasyon dahil). */
  @Get('tsoft/crm-orders-picklist')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  listCrmOrdersPicklist(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Query('limit') limit = '25',
  ) {
    return this.ecommerceService.listCrmOrdersPicklist(this.orgId(user), parseInt(limit, 10) || 25);
  }

  @Post('tsoft/sync-orders')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  syncTsoftOrders(
    @CurrentUser() user: { id: string; role?: string; organizationId?: string | null },
    @Body() body: { from?: string; to?: string } = {},
  ) {
    return this.ecommerceService.syncTsoftOrders(this.orgId(user), user.id, {
      dateStart: body?.from || null,
      dateEnd: body?.to || null,
    });
  }

  /** Admin paneli: T-Soft pull/push özet durumu */
  @Get('tsoft/sync-status')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getTsoftSyncStatus(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
  ) {
    return this.ecommerceService.getTsoftSyncStatus(this.orgId(user));
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
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.ecommerceService.listOrders(
      this.orgId(user),
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
      { dateStart: from || null, dateEnd: to || null },
    );
  }

  @Get('tsoft/customers')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  listCustomers(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.ecommerceService.listCustomers(
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

  @Post('tsoft/sync-catalog')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  syncTsoftCatalog(@CurrentUser() user: { role?: string; organizationId?: string | null }) {
    return this.ecommerceService.syncTsoftCatalog(this.orgId(user));
  }

  /** T-Soft → CRM ürün pull senkronu (plan §PR-3). `products` + `product_variants` yazar. */
  @Post('tsoft/sync-products')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  syncTsoftProducts(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Body()
    dto?: {
      variants?: boolean;
      images?: boolean;
      stock?: boolean;
      price?: boolean;
      descriptions?: boolean;
    },
  ) {
    return this.ecommerceService.syncTsoftProducts(this.orgId(user), dto ?? {});
  }

  @Get('tsoft/catalog')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  listTsoftCatalog(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('search') search?: string,
  ) {
    return this.ecommerceService.listTsoftCatalog(this.orgId(user), {
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
      search,
    });
  }

  @Get('tsoft/catalog/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getTsoftCatalogProduct(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Param('id') id: string,
  ) {
    return this.ecommerceService.getTsoftCatalogProduct(this.orgId(user), id);
  }

  @Patch('tsoft/catalog/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  updateTsoftCatalogProduct(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Param('id') id: string,
    @Body() dto: UpdateTsoftCatalogDto,
  ) {
    return this.ecommerceService.updateTsoftCatalogProduct(this.orgId(user), id, dto);
  }

  @Post('tsoft/catalog')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  createTsoftCatalogProduct(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Body() dto: CreateTsoftCatalogDto,
  ) {
    return this.ecommerceService.createTsoftCatalogProduct(this.orgId(user), dto);
  }

  @Delete('tsoft/catalog/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  deleteTsoftCatalogProduct(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Param('id') id: string,
    @Query('deleteOnSite') deleteOnSite?: string,
  ) {
    const del = deleteOnSite === 'true' || deleteOnSite === '1';
    return this.ecommerceService.deleteTsoftCatalogProduct(this.orgId(user), id, del);
  }

  /** T-Soft sitedeki siparişi numerik OrderId ile sil */
  @Post('tsoft/site-orders/delete')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  deleteTsoftSiteOrder(@CurrentUser() user: { role?: string; organizationId?: string | null }, @Body() dto: DeleteSiteOrderDto) {
    return this.ecommerceService.deleteTsoftSiteOrderByNumericId(this.orgId(user), dto.orderId);
  }

  @Post('tsoft/site-orders/status')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setTsoftSiteOrderStatus(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Body() dto: SetSiteOrderStatusDto,
  ) {
    return this.ecommerceService.setTsoftSiteOrderStatus(this.orgId(user), {
      orderNumericId: dto.orderNumericId,
      orderStatusId: dto.orderStatusId,
    });
  }

  @Get('tsoft/order-statuses')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  listTsoftOrderStatuses(@CurrentUser() user: { role?: string; organizationId?: string | null }) {
    return this.ecommerceService.listTsoftOrderStatuses(this.orgId(user));
  }

  /** CRM siparişini siteye gönderir (`tsoftSiteOrderId` kaydedilir) */
  @Post('tsoft/crm-orders/push')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  pushCrmOrderToTsoft(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Body() dto: PushSalesOrderToTsoftDto,
  ) {
    return this.ecommerceService.pushCrmSalesOrderToTsoft(this.orgId(user), dto.salesOrderId);
  }

  /** CRM’e bağlı site siparişini siler */
  @Post('tsoft/crm-orders/delete-site')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  deleteTsoftSiteOrderLinkedToCrm(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Body() dto: PushSalesOrderToTsoftDto,
  ) {
    return this.ecommerceService.deleteTsoftSiteOrderLinkedToCrm(this.orgId(user), dto.salesOrderId);
  }

  /** CRM siparişine bağlı site siparişinin durumunu günceller */
  @Patch('tsoft/crm-orders/:salesOrderId/site-status')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setTsoftSiteOrderStatusForCrmOrder(
    @CurrentUser() user: { role?: string; organizationId?: string | null },
    @Param('salesOrderId') salesOrderId: string,
    @Body() dto: SetCrmLinkedSiteOrderStatusDto,
  ) {
    return this.ecommerceService.setTsoftSiteOrderStatusFromCrm(
      this.orgId(user),
      salesOrderId,
      dto.orderStatusId,
    );
  }
}
