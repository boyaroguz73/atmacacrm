import {
  Controller, Get, Post, Patch, Param, Body, Query,
  UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { QuotesService } from './quotes.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QuoteStatus } from '@prisma/client';

@ApiTags('Quotes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('quotes')
export class QuotesController {
  constructor(private quotesService: QuotesService) {}

  @Get()
  findAll(
    @Query('status') status?: QuoteStatus,
    @Query('contactId') contactId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.quotesService.findAll({
      status,
      contactId,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.quotesService.findById(id);
  }

  @Post()
  create(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.quotesService.create(userId, body);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: QuoteStatus) {
    return this.quotesService.updateStatus(id, status);
  }

  @Post(':id/generate-pdf')
  generatePdf(@Param('id') id: string) {
    return this.quotesService.generatePdf(id).then((pdfUrl) => ({ pdfUrl }));
  }

  @Post(':id/send')
  send(@Param('id') id: string, @Body('sessionName') sessionName: string) {
    return this.quotesService.send(id, sessionName);
  }

  @Post(':id/convert-to-order')
  convertToOrder(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.quotesService.convertToOrder(id, userId);
  }
}
