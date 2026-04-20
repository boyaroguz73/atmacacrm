import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TsoftPushService } from '../ecommerce/tsoft-push.service';
import { Prisma } from '@prisma/client';

@ApiTags('Products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private productsService: ProductsService,
    private tsoftPush: TsoftPushService,
  ) {}

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('isActive') isActive?: string,
    @Query('matchExact') matchExact?: string,
  ) {
    return this.productsService.findAll({
      search,
      category,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      matchExact: matchExact === 'true' || matchExact === '1',
    });
  }

  @Get('categories-summary')
  getCategoriesSummary() {
    return this.productsService.getCategoriesSummary();
  }

  @Get(':id/variants')
  listVariants(@Param('id') id: string) {
    return this.productsService.findVariantsByProductId(id);
  }

  @Patch(':id/variants/:variantId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  updateVariant(
    @Param('id') productId: string,
    @Param('variantId') variantId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.productsService.updateVariant(
      productId,
      variantId,
      body as Prisma.ProductVariantUpdateInput,
    );
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.productsService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async create(
    @Req() req: any,
    @Body()
    body: {
      sku: string;
      name: string;
      description?: string;
      unit?: string;
      unitPrice: number;
      currency?: string;
      vatRate?: number;
      stock?: number;
      category?: string;
      /** true ise ürün T-Soft'a da gönderilir (push queue). */
      pushToTsoft?: boolean;
    },
  ) {
    const { pushToTsoft, ...data } = body;
    const product = await this.productsService.create(data);
    if (pushToTsoft && req.user?.organizationId) {
      await this.tsoftPush.enqueueProductOperation({
        organizationId: req.user.organizationId,
        productId: product.id,
        op: 'CREATE',
        payload: this.buildTsoftProductPayload(product) as Prisma.InputJsonValue,
      });
    }
    return product;
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const { pushToTsoft, productFeedSource: _pfs, ...data } = body || {};
    const updated = await this.productsService.update(id, data);
    if (pushToTsoft && req.user?.organizationId) {
      await this.tsoftPush.enqueueProductOperation({
        organizationId: req.user.organizationId,
        productId: updated.id,
        op: 'UPDATE',
        payload: this.buildTsoftProductPayload(updated) as Prisma.InputJsonValue,
      });
    }
    return updated;
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  async remove(@Req() req: any, @Param('id') id: string, @Query('pushToTsoft') pushToTsoft?: string) {
    const shouldPush = pushToTsoft === 'true' || pushToTsoft === '1';
    const existing = await this.productsService.findById(id);
    if (shouldPush && req.user?.organizationId && existing.sku) {
      // T-Soft'tan silinsin — DB'de tombstone için isActive=false bırak; kuyruk başarılı olunca hard delete yapılır.
      await this.productsService.update(id, { isActive: false });
      await this.tsoftPush.enqueueProductOperation({
        organizationId: req.user.organizationId,
        productId: id,
        op: 'DELETE',
        payload: { ProductCode: existing.sku } as Prisma.InputJsonValue,
      });
      return { queued: true };
    }
    return this.productsService.remove(id);
  }

  /**
   * CRM ürününden T-Soft setProducts/updateProducts payload'ı üretir.
   * T-Soft alan adları için {@link TsoftApiService.setProducts} dokümantasyonuna göre PascalCase.
   */
  private buildTsoftProductPayload(product: {
    sku: string;
    name: string;
    description: string | null;
    unitPrice: number;
    listPrice: number | null;
    salePriceAmount: number | null;
    currency: string;
    vatRate: number;
    stock: number | null;
    isActive: boolean;
    brand: string | null;
    category: string | null;
    imageUrl: string | null;
  }): Record<string, unknown> {
    return {
      ProductCode: product.sku,
      ProductName: product.name,
      ShortDescription: product.description ?? '',
      SellingPrice: product.salePriceAmount ?? product.unitPrice,
      ListPrice: product.listPrice ?? product.unitPrice,
      Currency: product.currency,
      Vat: product.vatRate,
      Stock: product.stock ?? 0,
      IsActive: product.isActive ? 1 : 0,
      Brand: product.brand ?? '',
      CategoryName: product.category ?? '',
      ...(product.imageUrl ? { ImageUrl: product.imageUrl } : {}),
    };
  }

  /** Harici URL'lere sahip tüm ürün görsellerini toplu olarak yerele indir */
  @Post('download-images')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  downloadImages() {
    return this.productsService.downloadAllProductImages();
  }
}
