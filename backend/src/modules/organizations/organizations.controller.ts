import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private orgService: OrganizationsService) {}

  private async resolveMyOrgId(req: any): Promise<string> {
    const direct = req.user.organizationId as string | null | undefined;
    if (direct) return direct;
    const first = await this.orgService.getFirstOrganizationId();
    if (!first) throw new BadRequestException('Organizasyon kaydı yok');
    return first;
  }

  // ===== ADMIN endpoints (kendi organizasyonu) =====

  @Get('my')
  @Roles('ADMIN')
  async getMyOrganization(@Req() req: any) {
    const orgId = await this.resolveMyOrgId(req);
    return this.orgService.findById(orgId);
  }

  @Patch('my')
  @Roles('ADMIN')
  async updateMyOrganization(
    @Req() req: any,
    @Body() body: {
      name?: string;
      primaryColor?: string;
      secondaryColor?: string;
      billingEmail?: string;
      billingName?: string;
      billingAddress?: string;
      taxNumber?: string;
    },
  ) {
    const orgId = await this.resolveMyOrgId(req);
    return this.orgService.updateBranding(orgId, body);
  }

  @Post('my/logo')
  @Roles('ADMIN')
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: diskStorage({
        destination: './uploads/logos',
        filename: (_req, file, cb) => {
          cb(null, `${uuid()}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (/\.(jpg|jpeg|png|svg|webp)$/i.test(file.originalname)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Sadece resim dosyaları kabul edilir'), false);
        }
      },
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async uploadLogo(@Req() req: any, @UploadedFile() file: any) {
    const orgId = await this.resolveMyOrgId(req);
    if (!file) throw new BadRequestException('Dosya yüklenmedi');

    const logoUrl = `/uploads/logos/${file.filename}`;
    await this.orgService.updateBranding(orgId, { logo: logoUrl });
    return { logo: logoUrl };
  }

  /** Geçerli kullanıcı rolü için menüde gösterilecek üst seviye anahtarlar */
  @Get('my/menu-visibility')
  @Roles('AGENT')
  async getMyMenuVisibility(@Req() req: any) {
    const orgId = await this.resolveMyOrgId(req);
    return this.orgService.getMenuVisibilityPayload(orgId, req.user?.role);
  }

  /** Menü görünürlüğü (rol başına izin verilen anahtar listesi); boş dizi = varsayılan */
  @Patch('my/menu-visibility')
  @Roles('ADMIN')
  async patchMyMenuVisibility(@Req() req: any, @Body() body: Record<string, string[] | undefined>) {
    const orgId = await this.resolveMyOrgId(req);
    return this.orgService.patchMenuVisibility(orgId, body as any);
  }

  @Get('my/menu-suborder')
  @Roles('AGENT')
  async getMyMenuSuborder(@Req() req: any) {
    const orgId = await this.resolveMyOrgId(req);
    return this.orgService.getMenuSuborder(orgId);
  }

  @Patch('my/menu-suborder')
  @Roles('ADMIN')
  async patchMyMenuSuborder(@Req() req: any, @Body() body: Record<string, string[] | undefined>) {
    const orgId = await this.resolveMyOrgId(req);
    return this.orgService.patchMenuSuborder(orgId, body);
  }

  @Get('my/default-location')
  @Roles('AGENT', 'ADMIN', 'SUPERADMIN')
  async getMyDefaultLocation(@Req() req: any) {
    const orgId = await this.resolveMyOrgId(req);
    return this.orgService.getDefaultLocationSettings(orgId);
  }

  @Patch('my/default-location')
  @Roles('ADMIN')
  async patchMyDefaultLocation(
    @Req() req: any,
    @Body()
    body: {
      latitude?: number | null;
      longitude?: number | null;
      title?: string | null;
      address?: string | null;
    },
  ) {
    const orgId = await this.resolveMyOrgId(req);
    return this.orgService.patchDefaultLocationSettings(orgId, body);
  }

  @Get('my/product-feed')
  @Roles('ADMIN', 'SUPERADMIN')
  async getMyProductFeed(@Req() req: any) {
    const orgId = await this.resolveMyOrgId(req);
    return this.orgService.getProductFeedSettings(orgId);
  }

  @Patch('my/product-feed')
  @Roles('ADMIN', 'SUPERADMIN')
  async patchMyProductFeed(
    @Req() req: any,
    @Body()
    body: {
      xmlUrl?: string;
      defaultVatRate?: number;
      importDescription?: boolean;
      importImages?: boolean;
      importMerchantMeta?: boolean;
    },
  ) {
    const orgId = await this.resolveMyOrgId(req);
    return this.orgService.patchProductFeedSettings(orgId, body);
  }

  // ===== SUPERADMIN endpoints (tüm organizasyonlar) =====

  @Get()
  @Roles('SUPERADMIN')
  findAll() {
    return this.orgService.findAll();
  }

  @Get('stats')
  @Roles('SUPERADMIN')
  getStats() {
    return this.orgService.getStats();
  }

  @Get(':id')
  @Roles('SUPERADMIN')
  findById(@Param('id') id: string) {
    return this.orgService.findById(id);
  }

  @Get(':id/dashboard')
  @Roles('SUPERADMIN')
  getOrgDashboard(@Param('id') id: string) {
    return this.orgService.getOrganizationDashboard(id);
  }

  @Post()
  @Roles('SUPERADMIN')
  create(
    @Body() body: {
      name: string;
      slug: string;
      plan?: string;
      maxUsers?: number;
      maxSessions?: number;
    },
  ) {
    return this.orgService.create(body);
  }

  @Patch(':id')
  @Roles('SUPERADMIN')
  update(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.orgService.update(id, body);
  }

  @Post(':id/assign-user')
  @Roles('SUPERADMIN')
  assignUser(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ) {
    return this.orgService.assignUserToOrg(userId, id);
  }

  @Post(':id/assign-session')
  @Roles('SUPERADMIN')
  assignSession(
    @Param('id') id: string,
    @Body('sessionId') sessionId: string,
  ) {
    return this.orgService.assignSessionToOrg(sessionId, id);
  }
}
