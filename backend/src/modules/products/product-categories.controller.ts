import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ProductCategoriesService } from './product-categories.service';

@ApiTags('Product categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('product-categories')
export class ProductCategoriesController {
  constructor(private readonly service: ProductCategoriesService) {}

  @Get()
  @Roles('AGENT')
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @Roles('ADMIN', 'SUPERADMIN')
  create(@Body() body: { name: string; description?: string | null; sortOrder?: number }) {
    return this.service.create(body);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPERADMIN')
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string | null; sortOrder?: number },
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPERADMIN')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
