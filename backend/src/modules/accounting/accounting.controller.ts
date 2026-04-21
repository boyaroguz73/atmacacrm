import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, Res, Logger,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
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
import { CashDirection, LedgerKind } from '@prisma/client';

const invoicesDir = join(process.cwd(), 'uploads', 'invoices');
if (!existsSync(invoicesDir)) mkdirSync(invoicesDir, { recursive: true });

const deliveryNotesDir = join(process.cwd(), 'uploads', 'delivery-notes');
if (!existsSync(deliveryNotesDir)) mkdirSync(deliveryNotesDir, { recursive: true });

const pdfStorage = diskStorage({
  destination: (_req, _file, cb) => {
    if (!existsSync(invoicesDir)) mkdirSync(invoicesDir, { recursive: true });
    cb(null, invoicesDir);
  },
  filename: (_req, file, cb) => cb(null, `${uuid()}${extname(file.originalname) || '.pdf'}`),
});

const deliveryPdfStorage = diskStorage({
  destination: (_req, _file, cb) => {
    if (!existsSync(deliveryNotesDir)) mkdirSync(deliveryNotesDir, { recursive: true });
    cb(null, deliveryNotesDir);
  },
  filename: (_req, file, cb) => cb(null, `${uuid()}${extname(file.originalname) || '.pdf'}`),
});

@ApiTags('Accounting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'ACCOUNTANT')
@Controller('accounting')
export class AccountingController {
  private readonly logger = new Logger(AccountingController.name);
  constructor(private accountingService: AccountingService) {}

  @Get('summary')
  dashboardSummary() {
    return this.accountingService.getDashboardSummary();
  }

  @Get('cash-entries')
  listCashEntries(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.accountingService.listCashBookEntries({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  @Post('cash-entries')
  createCashEntry(
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      amount: number;
      direction: CashDirection;
      description: string;
      occurredAt?: string;
      orderId?: string;
      invoiceId?: string;
      pdfUrl?: string;
    },
  ) {
    return this.accountingService.createCashBookEntry(userId, body);
  }

  @Get('ledger-entries')
  listLedgerEntries(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('contactId') contactId?: string,
  ) {
    return this.accountingService.listLedgerEntries({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      contactId,
    });
  }

  @Post('ledger-entries')
  createLedgerEntry(
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      kind: LedgerKind;
      title: string;
      amount: number;
      currency?: string;
      dueDate?: string | null;
      notes?: string | null;
      contactId?: string | null;
      pdfUrl?: string | null;
    },
  ) {
    return this.accountingService.createLedgerEntry(userId, body);
  }

  @Get('delivery-notes')
  listDeliveryNotes(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('orderId') orderId?: string,
  ) {
    return this.accountingService.listDeliveryNotes({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      orderId,
    });
  }

  @Post('delivery-notes')
  createDeliveryNote(
    @CurrentUser('id') userId: string,
    @Body() body: { orderId: string; notes?: string | null; shippedAt?: string | null },
  ) {
    return this.accountingService.createDeliveryNote(userId, body);
  }

  @Post('delivery-notes/:id/upload-pdf')
  @SkipThrottle()
  @UseInterceptors(FileInterceptor('file', {
    storage: deliveryPdfStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (extname(file.originalname).toLowerCase() === '.pdf') cb(null, true);
      else cb(new BadRequestException('Sadece PDF dosyaları kabul edilir'), false);
    },
  }))
  async uploadDeliveryNotePdf(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.logger.log(`İrsaliye PDF yükleme isteği: deliveryNoteId=${id}, file=${file?.originalname || 'YOK'}, size=${file?.size || 0}`);
    if (!file) throw new BadRequestException('Dosya yüklenmedi');
    const url = `/uploads/delivery-notes/${file.filename}`;
    return this.accountingService.uploadDeliveryNotePdf(id, url);
  }

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
    @Query('orderStatus') orderStatus?: string,
  ) {
    return this.accountingService.pendingBilling(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
      orderStatus,
    );
  }

  @Delete('invoices/:id')
  removeInvoice(@Param('id') id: string) {
    return this.accountingService.removeInvoice(id);
  }

  @Get('invoices/:id')
  findById(@Param('id') id: string) {
    return this.accountingService.findById(id);
  }

  @Get('invoices/:id/pdf')
  async servePdf(@Param('id') id: string, @Res() res: Response) {
    const inv = await this.accountingService.findById(id);
    const pdfPath = inv.uploadedPdfUrl || (inv as any).pdfUrl;
    if (!pdfPath) throw new NotFoundException('PDF bulunamadı');
    const fullPath = join(process.cwd(), pdfPath.replace(/^\//, ''));
    if (!existsSync(fullPath)) throw new NotFoundException('PDF dosyası bulunamadı');
    res.sendFile(fullPath);
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
  @SkipThrottle()
  @UseInterceptors(FileInterceptor('file', {
    storage: pdfStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (extname(file.originalname).toLowerCase() === '.pdf') cb(null, true);
      else cb(new BadRequestException('Sadece PDF dosyaları kabul edilir'), false);
    },
  }))
  async uploadPdf(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    this.logger.log(`Fatura PDF yükleme isteği: invoiceId=${id}, file=${file?.originalname || 'YOK'}, size=${file?.size || 0}`);
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
