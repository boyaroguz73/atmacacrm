import {
  Controller, Get, Post, Patch, Param, Body, Query,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AccountingService } from './accounting.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccInvoiceStatus } from '@prisma/client';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';

const pdfStorage = diskStorage({
  destination: './uploads/invoices',
  filename: (_req, file, cb) => cb(null, `${uuid()}${extname(file.originalname) || '.pdf'}`),
});

@ApiTags('Accounting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ACCOUNTANT')
@Controller('accounting')
export class AccountingController {
  constructor(private accountingService: AccountingService) {}

  @Get('invoices')
  findAll(
    @Query('status') status?: AccInvoiceStatus,
    @Query('contactId') contactId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.accountingService.findAll({
      status, contactId,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  @Get('invoices/pending-billing')
  pendingBilling(@Query('page') page?: string) {
    return this.accountingService.pendingBilling(page ? parseInt(page) : 1);
  }

  @Get('invoices/:id')
  findById(@Param('id') id: string) {
    return this.accountingService.findById(id);
  }

  @Post('invoices/from-order')
  createFromOrder(
    @CurrentUser('id') userId: string,
    @Body() body: { orderId: string; dueDate?: string; notes?: string },
  ) {
    return this.accountingService.createFromOrder(body.orderId, userId, body.dueDate, body.notes);
  }

  @Post('invoices')
  createManual(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.accountingService.createManual(userId, body);
  }

  @Patch('invoices/:id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: AccInvoiceStatus) {
    return this.accountingService.updateStatus(id, status);
  }

  @Post('invoices/:id/upload-pdf')
  @UseInterceptors(FileInterceptor('file', {
    storage: pdfStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (extname(file.originalname).toLowerCase() === '.pdf') cb(null, true);
      else cb(new BadRequestException('Sadece PDF dosyaları kabul edilir'), false);
    },
  }))
  async uploadPdf(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Dosya yüklenmedi');
    const url = `/uploads/invoices/${file.filename}`;
    return this.accountingService.uploadPdf(id, url);
  }

  @Post('invoices/:id/send')
  send(
    @Param('id') id: string,
    @Body() body: { sessionName: string; templateBody?: string },
  ) {
    return this.accountingService.send(id, body.sessionName, body.templateBody);
  }
}
