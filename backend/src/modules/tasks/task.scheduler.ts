import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../websocket/chat.gateway';

@Injectable()
export class TaskScheduler {
  private readonly logger = new Logger(TaskScheduler.name);

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkDueTasks() {
    const dueTasks = await this.prisma.task.findMany({
      where: {
        status: 'PENDING',
        dueAt: { lte: new Date() },
      },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        user: { select: { id: true, name: true } },
      },
    });

    if (dueTasks.length > 0) {
      this.logger.log(`${dueTasks.length} görev zamanı geldi`);
      this.chatGateway.server.emit('tasks:due', dueTasks);
    }
  }
}
