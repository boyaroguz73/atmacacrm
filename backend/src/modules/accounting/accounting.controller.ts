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
import { extname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { v4 as uuid } from 'uuid';

const invoicesDir = join(process.cwd(), 'uploads', 'invoices');
if (!existsSync(invoicesDir)) mkdirSync(invoicesDir, { recursive: true });

const pdfStorage = diskStorage({
  destination: (_req, _file, cb) => {
    if (!existsSync(invoicesDir)) mkdirSync(invoicesDir, { recursive: true });
    cb(null, invoicesDir);
  },
  filename: (_req, file, cb) => cb(null, `${uuid()}${extname(file.originalname) || '.pdf'}`),
});

@ApiTags('Accounting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'ACCOUNTANT')
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
  pendingBilling(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.accountingService.pendingBilling(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
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

  @Patch('invoices/:id')
  updateInvoiceMeta(
    @Param('id') id: string,
    @Body() body: { dueDate?: string | null; notes?: string | null },
  ) {
    return this.accountingService.updateMeta(id, body);
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
    @Body() body: { sessionName?: string; templateBody?: string },
  ) {
    return this.accountingService.send(id, body.sessionName || undefined, body.templateBody);
  }
}
