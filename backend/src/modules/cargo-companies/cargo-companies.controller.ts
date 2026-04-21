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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CargoCompaniesService } from './cargo-companies.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('CargoCompanies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cargo-companies')
export class CargoCompaniesController {
  constructor(private cargoCompaniesService: CargoCompaniesService) {}

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.cargoCompaniesService.findAll({
      search,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
    });
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.cargoCompaniesService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  create(
    @Body()
    body: {
      name: string;
      isAmbar?: boolean;
      phone?: string;
      notes?: string;
      isActive?: boolean;
    },
  ) {
    return this.cargoCompaniesService.create(body);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      isAmbar?: boolean;
      phone?: string;
      notes?: string;
      isActive?: boolean;
    },
  ) {
    return this.cargoCompaniesService.update(id, body);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  remove(@Param('id') id: string) {
    return this.cargoCompaniesService.remove(id);
  }
}
