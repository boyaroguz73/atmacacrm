import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PlanType } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { getPlanConfig } from '../billing/plan-config';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

/** Yeni kayıtlar: Başlangıç planı, kart gerektirmez; abonelik TRIALING olarak tutulur */
const REGISTER_STARTER_TRIAL_DAYS = 14;

function slugifyOrganizationName(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'org';
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private auditLog: AuditLogService,
    private prisma: PrismaService,
    private mailService: MailService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new ConflictException('Bu e-posta adresi zaten kayıtlı');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const plan = PlanType.STARTER;
    const planConfig = getPlanConfig(plan);
    const orgName = dto.organizationName.trim();
    let baseSlug = slugifyOrganizationName(orgName);

    const { user, organizationId } = await this.prisma.$transaction(
      async (tx) => {
        let slug = baseSlug;
        for (let attempt = 0; attempt < 12; attempt++) {
          const taken = await tx.organization.findUnique({
            where: { slug },
          });
          if (!taken) break;
          slug = `${baseSlug}-${randomBytes(2).toString('hex')}`;
        }

        const org = await tx.organization.create({
          data: {
            name: orgName,
            slug,
            plan,
            maxUsers: planConfig.maxUsers,
            maxSessions: planConfig.maxSessions,
          },
        });

        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + REGISTER_STARTER_TRIAL_DAYS);

        await tx.subscription.create({
          data: {
            organizationId: org.id,
            plan,
            status: 'TRIALING',
            priceMonthly: planConfig.price,
            currentPeriodStart: new Date(),
            currentPeriodEnd: trialEnd,
            trialEndsAt: trialEnd,
          },
        });

        const newUser = await tx.user.create({
          data: {
            email,
            name: dto.name.trim(),
            password: hashedPassword,
            role: 'ADMIN',
            organizationId: org.id,
          },
        });

        return { user: newUser, organizationId: org.id };
      },
    );

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        primaryColor: true,
        secondaryColor: true,
        plan: true,
      },
    });

    this.auditLog.log({
      userId: user.id,
      organizationId: user.organizationId ?? undefined,
      action: 'REGISTER',
      entity: 'User',
      entityId: user.id,
      details: {
        email: user.email,
        organizationId,
        plan,
        trialDays: REGISTER_STARTER_TRIAL_DAYS,
      },
    });

    const token = this.generateToken(user.id, user.email, user.role, user.organizationId);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
      },
      organization,
      accessToken: token,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account deactivated');
    }

    const token = this.generateToken(user.id, user.email, user.role, user.organizationId);

    let organization = null;
    if (user.organizationId) {
      organization = await this.prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          logo: true,
          primaryColor: true,
          secondaryColor: true,
          plan: true,
        },
      });
    }

    this.auditLog.log({
      userId: user.id,
      organizationId: user.organizationId ?? undefined,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      details: { email: user.email },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
      },
      organization,
      accessToken: token,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.usersService.findByEmail(dto.email.trim().toLowerCase());
    if (!user) {
      return { message: 'Eğer bu e-posta kayıtlıysa, şifre sıfırlama bağlantısı gönderildi.' };
    }

    await this.prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 saat

    await this.prisma.passwordReset.create({
      data: { userId: user.id, token, expiresAt },
    });

    const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:3000');
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    await this.mailService.sendPasswordReset(user.email, user.name, resetUrl);

    this.auditLog.log({
      userId: user.id,
      organizationId: user.organizationId ?? undefined,
      action: 'FORGOT_PASSWORD',
      entity: 'User',
      entityId: user.id,
      details: { email: user.email },
    });

    return { message: 'Eğer bu e-posta kayıtlıysa, şifre sıfırlama bağlantısı gönderildi.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const record = await this.prisma.passwordReset.findUnique({
      where: { token: dto.token },
      include: { user: true },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Geçersiz veya süresi dolmuş bağlantı');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { password: hashedPassword },
      }),
      this.prisma.passwordReset.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    this.auditLog.log({
      userId: record.userId,
      organizationId: record.user.organizationId ?? undefined,
      action: 'RESET_PASSWORD',
      entity: 'User',
      entityId: record.userId,
      details: { email: record.user.email },
    });

    return { message: 'Şifreniz başarıyla güncellendi' };
  }

  private generateToken(userId: string, email: string, role: string, organizationId?: string | null): string {
    return this.jwtService.sign({
      sub: userId,
      email,
      role,
      ...(organizationId ? { organizationId } : {}),
    });
  }
}
