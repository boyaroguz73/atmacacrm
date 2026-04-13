import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertConversationBelongsToOrg,
  inboxSocketRoomsForConversation,
  OrgSessionScopeUser,
} from '../../common/org-session-scope';

@WebSocketGateway({
  cors: {
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      'http://localhost:3000',
    ],
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Client ${client.id} bağlantısı reddedildi: Token yok`);
        client.disconnect();
        return;
      }

      const secret = this.configService.get<string>('JWT_SECRET');
      const payload = this.jwtService.verify(token, { secret });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, name: true, role: true, organizationId: true },
      });

      if (!user || !user) {
        this.logger.warn(`Client ${client.id} bağlantısı reddedildi: Kullanıcı bulunamadı`);
        client.disconnect();
        return;
      }

      (client as any).user = user;
      this.logger.log(`Client connected: ${client.id} (${user.email})`);
    } catch {
      this.logger.warn(`Client ${client.id} bağlantısı reddedildi: Geçersiz token`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join:conversation')
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: string,
  ) {
    const user = (client as any).user as OrgSessionScopeUser | undefined;
    if (!user || !conversationId) return;
    try {
      const c = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          session: { select: { organizationId: true } },
          contact: { select: { organizationId: true } },
        },
      });
      if (!c) return;
      assertConversationBelongsToOrg(c, user);
      client.join(`conversation:${conversationId}`);
      this.logger.debug(`Client ${client.id} joined conversation:${conversationId}`);
    } catch (e: any) {
      this.logger.warn(
        `join:conversation reddedildi (${conversationId}): ${e?.message ?? e}`,
      );
    }
  }

  @SubscribeMessage('leave:conversation')
  handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: string,
  ) {
    client.leave(`conversation:${conversationId}`);
  }

  @SubscribeMessage('join:inbox')
  handleJoinInbox(@ConnectedSocket() client: Socket) {
    const user = (client as any).user as
      | (OrgSessionScopeUser & { role?: string })
      | undefined;
    if (!user) return;
    client.join('inbox:all');
  }

  emitNewMessage(conversationId: string, data: any) {
    this.server
      .to(`conversation:${conversationId}`)
      .emit('message:new', data);

    const conv = data?.conversation;
    if (conv?.session && conv?.contact) {
      for (const room of inboxSocketRoomsForConversation(conv)) {
        this.server.to(room).emit('conversation:updated', conv);
      }
    } else {
      this.logger.warn(
        'emitNewMessage: conversation eksik (session/contact), inbox yayını atlandı',
      );
    }
  }

  emitMessageStatus(
    conversationId: string,
    data: { messageId: string; waMessageId: string; status: string },
  ) {
    this.server
      .to(`conversation:${conversationId}`)
      .emit('message:status', data);
  }

  emitSessionStatus(sessionName: string, status: string, _organizationId?: string | null) {
    this.server.to('inbox:all').emit('session:status', { sessionName, status });
  }

  emitConversationAssigned(
    conversationId: string,
    data: any,
    conversation?: {
      session: { organizationId: string | null };
      contact: { organizationId: string | null };
    },
  ) {
    const payload = { conversationId, ...data };
    if (conversation?.session && conversation?.contact) {
      for (const room of inboxSocketRoomsForConversation(conversation)) {
        this.server.to(room).emit('conversation:assigned', payload);
      }
    }
  }

  emitMessageReaction(conversationId: string, data: any) {
    this.server
      .to(`conversation:${conversationId}`)
      .emit('message:reaction', data);
  }

  emitMessageEdited(conversationId: string, data: any) {
    this.server
      .to(`conversation:${conversationId}`)
      .emit('message:edited', data);
  }
}
