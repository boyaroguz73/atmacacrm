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
  BadRequestException,
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
import { RefreshAllAvatarsDto } from './dto/refresh-all-avatars.dto';

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
    return this.contactsService.findAll({
      search,
      tag,
      from,
      to,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  /** Manuel kişi kaydı; openChat ile çalışan oturumda görüşme açılır */
  @Post()
  async create(
    @CurrentUser()
    user: {
      id: string;
      role: string;
      organizationId?: string | null;
    },
    @Body()
    body: {
      phone: string;
      name?: string;
      surname?: string;
      email?: string;
      source?: string;
      notes?: string;
      company?: string;
      city?: string;
      organizationId?: string;
      openChat?: boolean;
      sessionId?: string;
    },
  ) {
    let sessionId: string | undefined;
    if (body.openChat) {
      const sessions = await this.prisma.whatsappSession.findMany({
        where: whereWhatsappSessionsForOrg(user, { status: 'WORKING' }),
        orderBy: { updatedAt: 'desc' },
      });
      if (body.sessionId) {
        const pick = sessions.find((s) => s.id === body.sessionId);
        if (!pick) {
          throw new BadRequestException('Seçilen oturum bulunamadı veya çalışmıyor');
        }
        sessionId = pick.id;
      } else if (sessions[0]) {
        sessionId = sessions[0].id;
      }
    }

    return this.contactsService.createContact(user, {
      phone: body.phone,
      name: body.name,
      surname: body.surname,
      email: body.email,
      source: body.source,
      notes: body.notes,
      company: body.company,
      city: body.city,
      organizationId: body.organizationId,
      sessionId: sessionId ?? null,
    });
  }

  @Post('reset-all-avatars')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async resetAllAvatars() {
    const result = await this.contactsService.resetAllAvatars();
    return {
      message: `${result.cleared} kişinin avatarı sıfırlandı, ${result.filesDeleted} dosya silindi. Bir sonraki senkronda yeniden indirilecek.`,
      ...result,
    };
  }

  @Post('refresh-all-avatars')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async refreshAllAvatars(
    @Req() req: any,
    @Body() body: RefreshAllAvatarsDto,
  ) {
    const force = body.force === true;
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

    const contacts = await this.prisma.contact.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 15000,
    });

    if (contacts.length === 0) {
      return { message: 'Veritabanında kişi kaydı yok.', updated: 0 };
    }

    const eligible = contacts.filter((c) => {
      if (!force && c.avatarUrl) return false;
      const d = this.contactsService.digitsForWahaProfile(c.phone);
      return !!d;
    });

    this.logger.log(
      `Profil foto toplu yenileme başlatıldı: ${eligible.length} kişi (toplam=${contacts.length}, force=${force}, oturum=${workingSession.name})`,
    );

    this.runAvatarRefreshInBackground(workingSession.name, eligible, force);

    return {
      message: `${eligible.length} kişi için arka planda güncelleme başlatıldı. İlerleme backend loglarında görünür.`,
      updated: 0,
      total: eligible.length,
    };
  }

  private async runAvatarRefreshInBackground(
    sessionName: string,
    contacts: { id: string; phone: string }[],
    _force: boolean,
  ) {
    let updated = 0;
    let noPhoto = 0;
    let errors = 0;

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const waPhone = this.contactsService.digitsForWahaProfile(contact.phone);
      if (!waPhone) continue;

      try {
        const pictureUrl = await this.wahaService.getProfilePicture(
          sessionName,
          waPhone,
        );

        if (pictureUrl) {
          await this.contactsService.fetchAndSaveProfilePicture(
            contact.id,
            waPhone,
            pictureUrl,
          );
          updated++;
        } else {
          noPhoto++;
        }
      } catch (err: any) {
        errors++;
        this.logger.debug(`Avatar hatası (${contact.phone}): ${err.message}`);
      }

      if ((i + 1) % 25 === 0 || i === contacts.length - 1) {
        this.logger.log(
          `Avatar ilerleme: ${i + 1}/${contacts.length} işlendi (güncellendi=${updated}, foto yok=${noPhoto}, hata=${errors})`,
        );
      }

      await new Promise((r) => setTimeout(r, 100));
    }

    this.logger.log(
      `Avatar toplu yenileme tamamlandı: ${updated} güncellendi, ${noPhoto} foto yok, ${errors} hata (toplam ${contacts.length})`,
    );
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

    const waPhone = this.contactsService.digitsForWahaProfile(contact.phone);
    if (!waPhone) {
      return { message: 'Geçersiz telefon', avatarUrl: contact.avatarUrl };
    }

    const pictureUrl = await this.wahaService.getProfilePicture(
      workingSession.name,
      waPhone,
    );

    if (pictureUrl) {
      await this.contactsService.fetchAndSaveProfilePicture(
        contact.id,
        waPhone,
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
