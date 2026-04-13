import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Post,
  Delete,
  Logger,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ContactsService } from './contacts.service';
import { WahaService } from '../waha/waha.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { whereWhatsappSessionsForOrg, requireOrgId, assertBelongsToOrg } from '../../common/org-session-scope';

@ApiTags('Contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  private readonly logger = new Logger(ContactsController.name);

  constructor(
    private contactsService: ContactsService,
    private wahaService: WahaService,
    private prisma: PrismaService,
  ) {}

  @Get()
  findAll(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Query('search') search?: string,
    @Query('tag') tag?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const orgId = requireOrgId(user);
    return this.contactsService.findAll({
      search,
      tag,
      from,
      to,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      organizationId: orgId,
    });
  }

  @Post('refresh-all-avatars')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async refreshAllAvatars(@Req() req: any) {
    const u = req.user as { role?: string; organizationId?: string | null };
    const dbSessions = await this.prisma.whatsappSession.findMany({
      where: whereWhatsappSessionsForOrg(u, { status: 'WORKING' }),
      orderBy: { updatedAt: 'desc' },
      take: 1,
    });
    const workingSession = dbSessions[0];

    if (!workingSession) {
      return { message: 'Aktif oturum bulunamadı', updated: 0 };
    }

    const { contacts } = await this.contactsService.findAll({
      limit: 1000,
      ...(u.role !== 'SUPERADMIN' && u.organizationId
        ? { organizationId: u.organizationId }
        : {}),
    });
    let updated = 0;

    for (const contact of contacts) {
      if (contact.avatarUrl) continue;

      const pictureUrl = await this.wahaService.getProfilePicture(
        workingSession.name,
        contact.phone,
      );

      if (pictureUrl) {
        await this.contactsService.fetchAndSaveProfilePicture(
          contact.id,
          contact.phone,
          pictureUrl,
        );
        updated++;
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    this.logger.log(`${updated} kişinin profil fotoğrafı güncellendi`);
    return { message: `${updated} kişinin profil fotoğrafı güncellendi`, updated };
  }

  @Get(':id')
  async findOne(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Param('id') id: string,
  ) {
    const contact = await this.contactsService.findById(id);
    this.assertContactOrg(contact, user);
    return contact;
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Param('id') id: string,
    @Body() data: any,
  ) {
    const contact = await this.contactsService.findById(id);
    this.assertContactOrg(contact, user);
    return this.contactsService.update(id, data);
  }

  @Post(':id/tags')
  async addTag(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Param('id') id: string,
    @Body('tag') tag: string,
  ) {
    const contact = await this.contactsService.findById(id);
    this.assertContactOrg(contact, user);
    return this.contactsService.addTag(id, tag);
  }

  @Post(':id/refresh-avatar')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async refreshAvatar(@Req() req: any, @Param('id') id: string) {
    const contact = await this.contactsService.findById(id);
    const u = req.user as { role?: string; organizationId?: string | null };
    assertBelongsToOrg(u, contact.organizationId, 'kişiye');

    const dbSessions = await this.prisma.whatsappSession.findMany({
      where: whereWhatsappSessionsForOrg(u, { status: 'WORKING' }),
      orderBy: { updatedAt: 'desc' },
      take: 1,
    });
    const workingSession = dbSessions[0];

    if (!workingSession) {
      return { message: 'Aktif oturum bulunamadı', avatarUrl: contact.avatarUrl };
    }

    const pictureUrl = await this.wahaService.getProfilePicture(
      workingSession.name,
      contact.phone,
    );

    if (pictureUrl) {
      await this.contactsService.fetchAndSaveProfilePicture(
        contact.id,
        contact.phone,
        pictureUrl,
      );
      const updated = await this.contactsService.findById(id);
      return { avatarUrl: updated.avatarUrl };
    }

    return { message: 'Profil fotoğrafı bulunamadı', avatarUrl: null };
  }

  @Delete(':id/tags/:tag')
  async removeTag(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Param('id') id: string,
    @Param('tag') tag: string,
  ) {
    const contact = await this.contactsService.findById(id);
    this.assertContactOrg(contact, user);
    return this.contactsService.removeTag(id, tag);
  }

  @Delete(':id')
  async delete(
    @CurrentUser() user: { role: string; organizationId?: string },
    @Param('id') id: string,
  ) {
    const contact = await this.contactsService.findById(id);
    this.assertContactOrg(contact, user);
    return this.contactsService.delete(id);
  }

  private assertContactOrg(
    contact: { organizationId?: string | null },
    user: { role: string; organizationId?: string },
  ) {
    assertBelongsToOrg(user, contact.organizationId, 'kişiye');
  }
}
