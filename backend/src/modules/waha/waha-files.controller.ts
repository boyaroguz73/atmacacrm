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
    const result = await this.wahaService.downloadFile(session, fileId);
    if (!result) {
      return res.status(404).json({ message: 'Dosya bulunamadı' });
    }

    res.setHeader('Content-Type', result.mimetype);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(result.filename)}"`,
    );
    res.setHeader('Content-Length', result.data.length);
    res.send(result.data);
  }
}
