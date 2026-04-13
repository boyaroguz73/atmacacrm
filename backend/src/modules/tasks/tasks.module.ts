import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TaskScheduler } from './task.scheduler';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [WebsocketModule],
  controllers: [TasksController],
  providers: [TasksService, TaskScheduler],
  exports: [TasksService],
})
export class TasksModule {}
