import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  Req,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { v4 as uuid } from 'uuid';
import { SettingsService } from './settings.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('system-settings')
export class SettingsController {
  constructor(
    private settingsService: SettingsService,
    private auditLog: AuditLogService,
  ) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getAll() {
    return this.settingsService.getAll();
  }

  @Patch()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async updateSetting(
    @Body() body: { key: string; value: string },
    @Req() req: any,
  ) {
    const result = await this.settingsService.set(body.key, body.value);

    await this.auditLog.log({
      userId: req.user.id,
      organizationId: req.user.organizationId ?? undefined,
      action: 'UPDATE',
      entity: 'SystemSetting',
      details: { key: body.key, value: body.value },
    });

    return result;
  }

  /** PDF banka bölümünde kullanılacak FAST/EFT QR görseli (PNG/JPG) */
  @Post('upload-bank-qr')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'bank-qr');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          cb(null, `${uuid()}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(file.originalname)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Sadece görsel dosyaları kabul edilir (PNG, JPG, WEBP)'), false);
        }
      },
      limits: { fileSize: 3 * 1024 * 1024 },
    }),
  )
  async uploadBankQr(@UploadedFile() file: any, @Req() req: any) {
    if (!file) throw new BadRequestException('Dosya yüklenmedi');
    const url = `/uploads/bank-qr/${file.filename}`;
    await this.settingsService.set('pdf_bank_qr_url', url);

    await this.auditLog.log({
      userId: req.user.id,
      organizationId: req.user.organizationId ?? undefined,
      action: 'UPDATE',
      entity: 'SystemSetting',
      details: { key: 'pdf_bank_qr_url', value: url },
    });

    return { url };
  }
}
