import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  UseGuards, Logger, InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { QuotesService } from './quotes.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QuoteStatus, QuotePaymentMode } from '@prisma/client';

@ApiTags('Quotes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('quotes')
export class QuotesController {
  private readonly logger = new Logger(QuotesController.name);
  constructor(private quotesService: QuotesService) {}

  @Get()
  @Roles('AGENT')
  findAll(
    @Query('status') status?: QuoteStatus,
    @Query('contactId') contactId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.quotesService.findAll({
      status,
      contactId,
      from,
      to,
      search,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  @Get(':id')
  @Roles('AGENT')
  findById(@Param('id') id: string) {
    return this.quotesService.findById(id);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.quotesService.create(userId, body);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPERADMIN')
  remove(@Param('id') id: string) {
    return this.quotesService.remove(id);
  }

  @Patch(':id/status')
  @Roles('AGENT')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { 
      status: QuoteStatus; 
      paymentMode?: QuotePaymentMode; 
      partialPaymentAmount?: number;
      documentKind?: string;
    },
  ) {
    return this.quotesService.updateStatus(id, body);
  }

  @Patch(':id')
  @Roles('AGENT')
  updateMeta(
    @Param('id') id: string,
    @Body() body: {
      currency?: string | null;
      discountType?: 'PERCENT' | 'AMOUNT' | null;
      discountValue?: number | null;
      validUntil?: string | null;
      deliveryDate?: string | null;
      notes?: string | null;
      termsOverride?: string | null;
      footerNoteOverride?: string | null;
      documentKind?: string | null;
      items?: Array<{
        productId?: string;
        name: string;
        description?: string;
        quantity: number;
        unitPrice: number;
        vatRate: number;
        discountType?: 'PERCENT' | 'AMOUNT';
        discountValue?: number;
      }> | null;
    },
  ) {
    return this.quotesService.updateMeta(id, body);
  }

  @Post(':id/generate-pdf')
  @Roles('AGENT')
  generatePdf(@Param('id') id: string) {
    return this.quotesService.generatePdf(id).then((pdfUrl) => ({ pdfUrl }));
  }

  @Post(':id/send')
  @Roles('AGENT')
  async send(@Param('id') id: string, @Body('sessionName') sessionName?: string) {
    try {
      return await this.quotesService.send(id, sessionName);
    } catch (err: any) {
      this.logger.error(`Teklif gönderme hatası [${id}]: ${err.message}`, err.stack);
      // NestJS HTTP exception'ları olduğu gibi fırlat
      if (err.status) throw err;
      throw new InternalServerErrorException(err.message || 'Teklif gönderilemedi');
    }
  }

  @Post(':id/convert-to-order')
  @Roles('ACCOUNTANT', 'ADMIN')
  convertToOrder(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body?: { manual?: boolean },
  ) {
    return this.quotesService.convertToOrder(id, userId, { manual: body?.manual === true });
  }

  /** Teklif versiyonu oluştur */
  @Post(':id/versions')
  @Roles('AGENT')
  createVersion(@Param('id') id: string) {
    return this.quotesService.createVersion(id);
  }

  /** Teklif versiyonlarını getir */
  @Get(':id/versions')
  @Roles('AGENT')
  getVersions(@Param('id') id: string) {
    return this.quotesService.getVersions(id);
  }

  /** Belirli bir versiyonu getir */
  @Get('versions/:versionId')
  @Roles('AGENT')
  getVersion(@Param('versionId') versionId: string) {
    return this.quotesService.getVersion(versionId);
  }
}
