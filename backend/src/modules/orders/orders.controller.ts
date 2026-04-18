import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrderStatus } from '@prisma/client';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Get()
  @Roles('AGENT')
  findAll(
    @Query('status') status?: OrderStatus,
    @Query('contactId') contactId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ordersService.findAll({
      status, contactId, from, to, search,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  @Post(':id/regenerate-confirmation-pdf')
  @Roles('ACCOUNTANT', 'ADMIN', 'SUPERADMIN')
  regenerateConfirmationPdf(@Param('id') id: string) {
    return this.ordersService.regenerateConfirmationPdf(id);
  }

  @Get(':id')
  @Roles('AGENT')
  findById(@Param('id') id: string) {
    return this.ordersService.findById(id);
  }

  @Post()
  @Roles('AGENT')
  create(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() body: any,
  ) {
    return this.ordersService.create(userId, { ...body, organizationId });
  }

  @Patch(':id/status')
  @Roles('AGENT')
  updateStatus(@Param('id') id: string, @Body('status') status: OrderStatus) {
    return this.ordersService.updateStatus(id, status);
  }

  @Patch(':id')
  @Roles('AGENT')
  updateMeta(
    @Param('id') id: string,
    @Body()
    body: {
      expectedDeliveryDate?: string | null;
      notes?: string | null;
      shippingAddress?: string | null;
    },
  ) {
    return this.ordersService.updateMeta(id, body);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPERADMIN', 'ACCOUNTANT')
  remove(@Param('id') id: string) {
    return this.ordersService.remove(id);
  }

  @Get(':id/items')
  @Roles('AGENT')
  getOrderItems(@Param('id') id: string) {
    return this.ordersService.getOrderItems(id);
  }

  @Patch('items/:itemId')
  @Roles('ADMIN', 'SUPERADMIN', 'ACCOUNTANT')
  updateOrderItem(
    @Param('itemId') itemId: string,
    @Body()
    body: {
      supplierId?: string | null;
      supplierOrderNo?: string | null;
      isFromStock?: boolean;
    },
  ) {
    return this.ordersService.updateOrderItem(itemId, body);
  }
}
