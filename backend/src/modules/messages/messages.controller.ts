import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { ConversationsService } from '../conversations/conversations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { assertConversationBelongsToOrg } from '../../common/org-session-scope';
import { PrismaService } from '../prisma/prisma.service';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';
import { SendTextMessageDto } from './dto/send-text.dto';
import { SendMediaMessageDto } from './dto/send-media.dto';
import { EditMessageDto } from './dto/edit-message.dto';

const imageStorage = diskStorage({
  destination: './uploads',
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname) || '.jpg';
    cb(null, `${uuid()}${ext}`);
  },
});

@ApiTags('Messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);

  constructor(
    private messagesService: MessagesService,
    private conversationsService: ConversationsService,
    private prisma: PrismaService,
  ) {}

  @Get('conversation/:conversationId')
  async getMessages(
    @CurrentUser()
    user: { role: string; organizationId?: string | null },
    @Param('conversationId') conversationId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const conversation =
      await this.conversationsService.findById(conversationId);
    assertConversationBelongsToOrg(conversation, user);
    return this.messagesService.getByConversation(conversationId, {
      cursor,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  @Post('send')
  async sendText(
    @Body() body: SendTextMessageDto,
    @CurrentUser()
    user: {
      id: string;
      role: string;
      organizationId?: string | null;
    },
  ) {
    const conversation = await this.conversationsService.findById(
      body.conversationId,
    );
    assertConversationBelongsToOrg(conversation, user);
    return this.messagesService.sendText({
      ...body,
      sentById: user.id,
    });
  }

  @Post('send-media')
  async sendMedia(
    @Body() body: SendMediaMessageDto,
    @CurrentUser()
    user: {
      id: string;
      role: string;
      organizationId?: string | null;
    },
  ) {
    const conversation = await this.conversationsService.findById(
      body.conversationId,
    );
    assertConversationBelongsToOrg(conversation, user);
    try {
      return await this.messagesService.sendMedia({
        ...body,
        sentById: user.id,
      });
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Medya gönderilemedi');
    }
  }

  @Patch(':messageId/edit')
  async editMessage(
    @Param('messageId') messageId: string,
    @Body() body: EditMessageDto,
    @CurrentUser()
    user: {
      id: string;
      role: string;
      organizationId?: string | null;
    },
  ) {
    const row = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { conversationId: true },
    });
    if (!row) throw new NotFoundException('Mesaj bulunamadı');
    const conversation = await this.conversationsService.findById(
      row.conversationId,
    );
    assertConversationBelongsToOrg(conversation, user);
    try {
      return await this.messagesService.editMessage({
        messageId,
        ...body,
        userId: user.id,
      });
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Mesaj düzenlenemedi');
    }
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: imageStorage,
      limits: { fileSize: 16 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = /\.(jpg|jpeg|png|gif|webp|mp4|mp3|ogg|opus|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar)$/i;
        if (allowed.test(extname(file.originalname))) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Desteklenmeyen dosya formatı'), false);
        }
      },
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Dosya yüklenemedi');
    const url = `/uploads/${file.filename}`;
    return { url, filename: file.originalname, size: file.size };
  }
}
