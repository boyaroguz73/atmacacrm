import { Module, forwardRef } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductCategoriesService } from './product-categories.service';
import { ProductCategoriesController } from './product-categories.controller';
import { OrganizationsModule } from '../organizations/organizations.module';
import { EcommerceModule } from '../ecommerce/ecommerce.module';

@Module({
  imports: [OrganizationsModule, forwardRef(() => EcommerceModule)],
  controllers: [ProductsController, ProductCategoriesController],
  providers: [ProductsService, ProductCategoriesService],
  exports: [ProductsService],
})
export class ProductsModule {}
