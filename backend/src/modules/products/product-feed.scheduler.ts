import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from './products.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { DEFAULT_PRODUCT_XML_FEED_URL } from './product-feed.constants';

@Injectable()
export class ProductFeedScheduler {
  private readonly logger = new Logger(ProductFeedScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly productsService: ProductsService,
    private readonly prisma: PrismaService,
    private readonly orgService: OrganizationsService,
  ) {}

  /** Her saat başı (dakika 0, saniye 0) */
  @Cron('0 0 * * * *')
  async runHourly(): Promise<void> {
    const fromEnv = this.config.get<string>('PRODUCT_XML_FEED_URL')?.trim();
    const orgs = await this.prisma.organization.findMany({ select: { id: true } });
    const targets =
      orgs.length > 0
        ? orgs
        : [{ id: null as string | null }];

    for (const o of targets) {
      try {
        let url = fromEnv || DEFAULT_PRODUCT_XML_FEED_URL;
        let opts: Parameters<ProductsService['syncFromGoogleShoppingXml']>[1] = undefined;
        if (o.id) {
          const feed = await this.orgService.getProductFeedSettings(o.id);
          url = (feed.xmlUrl && feed.xmlUrl.trim()) || fromEnv || DEFAULT_PRODUCT_XML_FEED_URL;
          opts = {
            defaultVatRate: feed.defaultVatRate,
            importDescription: feed.importDescription,
            importImages: feed.importImages,
            importMerchantMeta: feed.importMerchantMeta,
          };
        }
        const r = await this.productsService.syncFromGoogleShoppingXml(url, opts);
        this.logger.log(
          `[org=${o.id ?? 'env'}] XML ürün senkron: ${r.imported} yeni, ${r.updated} güncellendi, ${r.deactivated} pasif, ${r.errors.length} hata`,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`XML ürün senkron başarısız [org=${o.id ?? 'env'}]: ${msg}`);
      }
    }
  }
}
