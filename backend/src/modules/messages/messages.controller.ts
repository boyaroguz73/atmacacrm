import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { ConversationsService } from '../conversations/conversations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';
import { SendTextMessageDto } from './dto/send-text.dto';
import { SendMediaMessageDto } from './dto/send-media.dto';
import { SendProductShareDto } from './dto/send-product-share.dto';
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
  constructor(
    private messagesService: MessagesService,
    private conversationsService: ConversationsService,
    private prisma: PrismaService,
  ) {}

  @Get('conversation/:conversationId')
  async getMessages(
    @CurrentUser() _user: { role: string; organizationId?: string | null },
    @Param('conversationId') conversationId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messagesService.getByConversation(conversationId, {
      cursor,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  @Post('send')
  sendText(
    @Body() body: SendTextMessageDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.messagesService.sendText({ ...body, sentById: user.id });
  }

  @Post('send-media')
  async sendMedia(
    @Body() body: SendMediaMessageDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.messagesService.sendMedia({ ...body, sentById: user.id });
  }

  @Post('send-product')
  sendProduct(
    @Body() body: SendProductShareDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.messagesService.sendProductShare({
      conversationId: body.conversationId,
      productId: body.productId,
      sentById: user.id,
      sessionName: body.sessionName,
      chatId: body.chatId,
    });
  }

  @Patch(':messageId/edit')
  async editMessage(
    @Param('messageId') messageId: string,
    @Body() body: EditMessageDto,
    @CurrentUser() user: { id: string },
  ) {
    const row = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { conversationId: true },
    });
    if (!row) throw new NotFoundException('Mesaj bulunamadı');
    return this.messagesService.editMessage({
      messageId,
      ...body,
      userId: user.id,
    });
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
    return { url: `/uploads/${file.filename}`, filename: file.originalname, size: file.size };
  }

  /** WAHA Plus - Mesaja yanıt gönder */
  @Post('send-reply')
  sendReply(
    @Body() body: {
      conversationId: string;
      sessionName: string;
      chatId: string;
      body: string;
      quotedMessageId: string;
    },
    @CurrentUser() user: { id: string },
  ) {
    return this.messagesService.sendReply({ ...body, sentById: user.id });
  }

  /** WAHA Plus - Mesaj silme */
  @Delete(':messageId')
  deleteMessage(
    @Param('messageId') messageId: string,
    @Body() body: { sessionName: string; chatId: string; forEveryone?: boolean },
  ) {
    return this.messagesService.deleteMessage({
      messageId,
      sessionName: body.sessionName,
      chatId: body.chatId,
      forEveryone: body.forEveryone,
    });
  }

  /** WAHA Plus - Emoji tepki gönder */
  @Post(':messageId/reaction')
  sendReaction(
    @Param('messageId') messageId: string,
    @Body() body: { sessionName: string; chatId: string; emoji: string },
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.messagesService.sendReaction({
      messageId,
      sessionName: body.sessionName,
      chatId: body.chatId,
      emoji: body.emoji,
      userId: user.id,
      userName: user.name,
    });
  }

  /** WAHA Plus - Konum gönder */
  @Post('send-location')
  sendLocation(
    @Body() body: {
      conversationId: string;
      sessionName: string;
      chatId: string;
      latitude: number;
      longitude: number;
      title?: string;
      address?: string;
    },
    @CurrentUser() user: { id: string },
  ) {
    return this.messagesService.sendLocation({ ...body, sentById: user.id });
  }

  @Post('send-contact')
  sendContact(
    @Body() body: {
      conversationId: string;
      sessionName: string;
      chatId: string;
      contactName: string;
      contactPhone: string;
    },
    @CurrentUser() user: { id: string },
  ) {
    return this.messagesService.sendContact({ ...body, sentById: user.id });
  }
}
