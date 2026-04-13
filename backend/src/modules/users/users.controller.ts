import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Delete,
  Req,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import * as bcrypt from 'bcryptjs';
import { requireOrgId, assertBelongsToOrg } from '../../common/org-session-scope';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private auditLog: AuditLogService,
  ) {}

  @Get('all-grouped')
  @Roles('SUPERADMIN')
  findAllGrouped() {
    return this.usersService.findAllGrouped();
  }

  @Get('agents')
  findAgents(@Req() req: any) {
    return this.usersService.findAgents(requireOrgId(req.user));
  }

  /** Gelen kutusu mesaj filtresi: ADMIN + AGENT (tek firma; isteğe bağlı ?organizationId= daraltır). */
  @Get('inbox-peers')
  findInboxPeers(@Req() req: any, @Query('organizationId') organizationId?: string) {
    const u = req.user;
    const org = organizationId?.trim() || u.organizationId || undefined;
    return this.usersService.findInboxPeers(org);
  }

  @Get()
  @Roles('ADMIN')
  findAll(@Req() req: any) {
    return this.usersService.findAll(requireOrgId(req.user));
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    const target = await this.usersService.findById(id);
    this.assertSameOrg(req.user, target);
    return target;
  }

  @Post()
  @Roles('ADMIN')
  async createAgent(
    @Body()
    body: {
      email: string;
      name: string;
      password: string;
      role?: string;
    },
    @Req() req: any,
  ) {
    const existing = await this.usersService.findByEmail(body.email);
    if (existing) throw new ConflictException('Bu e-posta zaten kayıtlı');

    if (body.role === 'SUPERADMIN') {
      throw new ForbiddenException('SUPERADMIN rolü atanamaz');
    }

    const hashedPassword = await bcrypt.hash(body.password, 12);
    const user = await this.usersService.create({
      email: body.email,
      name: body.name,
      password: hashedPassword,
      role: (body.role as any) || 'AGENT',
      ...(req.user.organizationId && {
        organization: { connect: { id: req.user.organizationId } },
      }),
    });

    await this.auditLog.log({
      userId: req.user.id,
      organizationId: req.user.organizationId ?? undefined,
      action: 'CREATE',
      entity: 'User',
      entityId: user.id,
      details: { name: body.name, email: body.email, role: body.role || 'AGENT' },
    });

    return user;
  }

  @Patch(':id')
  @Roles('ADMIN')
  async update(
    @Param('id') id: string,
    @Body() data: { name?: string; email?: string; role?: string; isActive?: boolean },
    @Req() req: any,
  ) {
    if (data.role === 'SUPERADMIN') {
      throw new ForbiddenException('SUPERADMIN rolü atanamaz');
    }

    const target = await this.usersService.findById(id);
    this.assertSameOrg(req.user, target);

    const result = await this.usersService.update(id, data as any);

    await this.auditLog.log({
      userId: req.user.id,
      organizationId: req.user.organizationId ?? undefined,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      details: data,
    });

    return result;
  }

  @Patch(':id/password')
  @Roles('ADMIN')
  async resetPassword(
    @Param('id') id: string,
    @Body('password') password: string,
    @Req() req: any,
  ) {
    const target = await this.usersService.findById(id);
    this.assertSameOrg(req.user, target);

    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await this.usersService.update(id, { password: hashedPassword });

    await this.auditLog.log({
      userId: req.user.id,
      organizationId: req.user.organizationId ?? undefined,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      details: { action: 'Şifre değiştirildi' },
    });

    return result;
  }

  @Delete(':id')
  @Roles('ADMIN')
  async deactivate(@Param('id') id: string, @Req() req: any) {
    const target = await this.usersService.findById(id);
    this.assertSameOrg(req.user, target);

    await this.auditLog.log({
      userId: req.user.id,
      organizationId: req.user.organizationId ?? undefined,
      action: 'DELETE',
      entity: 'User',
      entityId: id,
    });

    return this.usersService.deactivate(id);
  }

  @Patch(':id/activate')
  @Roles('ADMIN')
  async activate(@Param('id') id: string, @Req() req: any) {
    const target = await this.usersService.findById(id);
    this.assertSameOrg(req.user, target);

    await this.auditLog.log({
      userId: req.user.id,
      organizationId: req.user.organizationId ?? undefined,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      details: { isActive: true },
    });

    return this.usersService.update(id, { isActive: true });
  }

  private assertSameOrg(
    currentUser: { role: string; organizationId?: string | null },
    targetUser: { organizationId?: string | null } | null,
  ) {
    if (!targetUser) return;
    assertBelongsToOrg(currentUser, targetUser.organizationId, 'kullanıcıya');
  }
}
