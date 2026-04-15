import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { ProductsService } from './products.service';
import { DEFAULT_PRODUCT_XML_FEED_URL } from './product-feed.constants';

@Injectable()
export class ProductFeedScheduler {
  private readonly logger = new Logger(ProductFeedScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly productsService: ProductsService,
  ) {}

  /** Her saat başı (dakika 0, saniye 0) */
  @Cron('0 0 * * * *')
  async runHourly(): Promise<void> {
    const fromEnv = this.config.get<string>('PRODUCT_XML_FEED_URL')?.trim();
    const url = fromEnv || DEFAULT_PRODUCT_XML_FEED_URL;
    try {
      const r = await this.productsService.syncFromGoogleShoppingXml(url);
      this.logger.log(
        `XML ürün senkron tamam: ${r.imported} yeni, ${r.updated} güncellendi, ${r.deactivated} akışta olmayan XML ürünü pasifleştirildi, ${r.errors.length} hata`,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`XML ürün senkron başarısız: ${msg}`);
    }
  }
}
