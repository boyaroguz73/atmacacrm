import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';
import { KartelasService } from './kartelas.service';

const kartelaStorage = diskStorage({
  destination: './uploads/kartelas',
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname) || '.bin';
    cb(null, `${uuid()}${ext}`);
  },
});

@ApiTags('Kartelas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('kartelas')
export class KartelasController {
  constructor(private readonly kartelasService: KartelasService) {}

  @Get()
  findAll(@Query('search') search?: string) {
    return this.kartelasService.findAll(search);
  }

  @Post('upload')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'AGENT', 'SUPERADMIN')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: kartelaStorage,
      limits: { fileSize: 64 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = /\.(jpg|jpeg|png|pdf)$/i;
        if (allowed.test(extname(file.originalname))) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Sadece jpg, jpeg, png veya pdf yüklenebilir'), false);
        }
      },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
    @CurrentUser() user: { id?: string; name?: string },
  ) {
    if (!file) throw new BadRequestException('Kartela dosyası gerekli');
    return this.kartelasService.createFromUpload(file, { name }, user);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'AGENT', 'SUPERADMIN')
  remove(@Param('id') id: string) {
    return this.kartelasService.remove(id);
  }
}
