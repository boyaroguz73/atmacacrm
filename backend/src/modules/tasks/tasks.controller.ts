import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TaskStatus } from '@prisma/client';
import { requireOrgId } from '../../common/org-session-scope';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private tasksService: TasksService) {}


  @Get('my')
  getMyTasks(
    @CurrentUser('id') userId: string,
    @Query('status') status?: TaskStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    return this.tasksService.findByUser(userId, {
      status,
      from,
      to,
      page: page ? parseInt(page) : 1,
    });
  }

  @Get('my-unassigned')
  getMyUnassignedTasks(
    @CurrentUser() user: { id: string; role: string; organizationId?: string },
    @Query('status') status?: TaskStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    return this.tasksService.findUnassignedForOrganization({
      organizationId: requireOrgId(user),
      status,
      from,
      to,
      page: page ? parseInt(page) : 1,
    });
  }

  @Get('my/stats')
  getMyStats(@CurrentUser('id') userId: string) {
    return this.tasksService.getStats(userId);
  }

  @Get('due')
  getDueTasks(@CurrentUser() user: { id: string; role: string; organizationId?: string }) {
    return this.tasksService.getDueTasks(requireOrgId(user));
  }

  @Get('all')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getAllTasks(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Query('status') status?: TaskStatus,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    return this.tasksService.findAll({
      status,
      userId,
      from,
      to,
      page: page ? parseInt(page) : 1,
      organizationId: requireOrgId(user),
    });
  }

  @Get('all/stats')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getAllStats(@CurrentUser() user: { role: string; organizationId?: string }) {
    return this.tasksService.getStats(undefined, requireOrgId(user));
  }

  @Post()
  createTask(
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      contactId?: string;
      title: string;
      description?: string;
      dueAt: string;
    },
  ) {
    return this.tasksService.create({
      userId,
      contactId: body.contactId,
      title: body.title,
      description: body.description,
      dueAt: new Date(body.dueAt),
    });
  }

  @Patch(':id/complete')
  completeTask(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string; organizationId?: string },
  ) {
    return this.tasksService.complete(id, user.id, user.role);
  }

  @Patch(':id/cancel')
  cancelTask(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string; organizationId?: string },
  ) {
    return this.tasksService.cancel(id, user.id, user.role);
  }
}
