import { Controller, Get, Param, Res, Logger, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { WahaService } from './waha.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('files')
export class WahaFilesController {
  private readonly logger = new Logger(WahaFilesController.name);

  constructor(private wahaService: WahaService) {}

  @Get(':session/:fileId')
  async proxyFile(
    @Param('session') session: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    const lower = String(fileId || '').toLowerCase();
    const extMatch = lower.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar|7z|jpg|jpeg|png|gif|webp|mp4|mov|m4v|webm|3gp|mp3|ogg|opus|m4a|aac|wav)$/);
    const requestedExt = extMatch?.[0] || '';
    const rawFileId = requestedExt ? String(fileId).slice(0, -requestedExt.length) : fileId;

    // WAHA çoğunlukla ham message/file id bekler; biz URL'de uzantı taşısak da
    // önce uzantısız id ile deneriz, olmazsa geriye uyumluluk için orijinali deneriz.
    let result = await this.wahaService.downloadFile(session, rawFileId);
    if (!result && rawFileId !== fileId) {
      result = await this.wahaService.downloadFile(session, fileId);
    }
    if (!result) {
      return res.status(404).json({ message: 'Dosya bulunamadı' });
    }

    const mimeByExt: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.zip': 'application/zip',
      '.rar': 'application/vnd.rar',
      '.7z': 'application/x-7z-compressed',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.m4v': 'video/x-m4v',
      '.webm': 'video/webm',
      '.3gp': 'video/3gpp',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.opus': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.wav': 'audio/wav',
    };
    const normalizedMime =
      result.mimetype === 'application/octet-stream' && requestedExt
        ? mimeByExt[requestedExt] || result.mimetype
        : result.mimetype;

    res.setHeader('Content-Type', normalizedMime);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(result.filename)}"`,
    );
    res.setHeader('Content-Length', result.data.length);
    res.send(result.data);
  }
}
