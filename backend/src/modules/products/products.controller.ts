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
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DEFAULT_PRODUCT_XML_FEED_URL } from './product-feed.constants';
import { OrganizationsService } from '../organizations/organizations.service';

@ApiTags('Products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private productsService: ProductsService,
    private config: ConfigService,
    private orgService: OrganizationsService,
  ) {}

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.productsService.findAll({
      search,
      category,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
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

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.productsService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(
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
    },
  ) {
    return this.productsService.create(body);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() body: any) {
    return this.productsService.update(id, body);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  /** Google Shopping XML akışını hemen çek ve ürünleri güncelle (cron ile aynı mantık) */
  @Post('sync-feed')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  async syncFeed(@Req() req: any, @Body() body?: { url?: string }) {
    let orgId = req.user?.organizationId as string | undefined;
    if (!orgId) orgId = (await this.orgService.getFirstOrganizationId()) ?? undefined;
    if (!orgId) throw new BadRequestException('Organizasyon bulunamadı');
    const feed = await this.orgService.getProductFeedSettings(orgId);
    const fromEnv = this.config.get<string>('PRODUCT_XML_FEED_URL')?.trim();
    const url =
      (body?.url && body.url.trim()) ||
      (feed.xmlUrl && feed.xmlUrl.trim()) ||
      fromEnv ||
      DEFAULT_PRODUCT_XML_FEED_URL;
    return this.productsService.syncFromGoogleShoppingXml(url, {
      defaultVatRate: feed.defaultVatRate,
      importDescription: feed.importDescription,
      importImages: feed.importImages,
      importMerchantMeta: feed.importMerchantMeta,
    });
  }
}
