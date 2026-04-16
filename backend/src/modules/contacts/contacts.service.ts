import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import axios from 'axios';
import {
  canonicalContactPhone,
  contactPhoneLookupKeys,
  isValidPhoneNumber,
} from '../../common/contact-phone';
import { splitSearchTokens } from '../../common/search-tokens';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(private prisma: PrismaService) {}

  async findOrCreate(phone: string, name?: string, organizationId?: string | null) {
    const keys = contactPhoneLookupKeys(phone).filter(Boolean);
    const primary =
      canonicalContactPhone(phone) || keys[0] || String(phone ?? '').replace(/\D/g, '');
    if (!primary) {
      this.logger.warn(`findOrCreate: geçersiz/boş telefon (${phone})`);
      throw new BadRequestException('Geçersiz telefon numarası');
    }

    const existing = await this.prisma.contact.findFirst({
      where: { phone: { in: keys } },
    });

    if (existing) {
      const updates: { phone?: string; organizationId?: string } = {};
      
      if (existing.phone !== primary) {
        updates.phone = primary;
      }
      
      // pushName ASLA kullanılmıyor - isim yalnızca manuel güncellenebilir
      
      // organizationId boşsa ve yeni değer varsa güncelle
      if (!existing.organizationId && organizationId) {
        updates.organizationId = organizationId;
      }
      
      if (Object.keys(updates).length > 0) {
        try {
          return await this.prisma.contact.update({
            where: { id: existing.id },
            data: updates,
          });
        } catch {
          /* eşsizlik çakışması: başka satır aynı primary kullanıyorsa eski kaydı bırak */
        }
      }
      return this.prisma.contact.findUniqueOrThrow({ where: { id: existing.id } });
    }

    // pushName kullanmıyoruz - yeni kişi için isim boş bırakılır
    // Frontend'de isim yoksa telefon numarası gösterilecek
    return this.prisma.contact.create({
      data: { 
        phone: primary, 
        name: (name && name.trim()) || null,
        organizationId: organizationId || null,
      },
    });
  }

  /**
   * WhatsApp grupları için placeholder contact oluştur/bul.
   * Gruplar telefon numarası olmadığından özel bir şekilde işlenir.
   * waGroupId (örn: 123456789@g.us) phone alanında saklanır ama gruplar 
   * isGroup:true conversation'a bağlanır.
   */
  async findOrCreateForGroup(
    waGroupId: string, 
    groupName: string, 
    organizationId?: string | null,
  ) {
    // Grup JID'sini temizle ve anahtar olarak kullan
    const groupKey = `group:${waGroupId.toLowerCase()}`;
    
    // Önce mevcut grup contact'ı bul
    const existing = await this.prisma.contact.findFirst({
      where: { phone: groupKey },
    });

    if (existing) {
      // Grup adı değiştiyse güncelle
      if (existing.name !== groupName && groupName) {
        try {
          return await this.prisma.contact.update({
            where: { id: existing.id },
            data: { name: groupName },
          });
        } catch {
          return existing;
        }
      }
      return existing;
    }

    // Yeni grup contact'ı oluştur
    return this.prisma.contact.create({
      data: {
        phone: groupKey,
        name: groupName || 'WhatsApp Grubu',
        organizationId: organizationId || null,
      },
    });
  }

  async findAll(params: {
    search?: string;
    tag?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    organizationId?: string;
  }) {
    const { search, tag, from, to, page = 1, limit = 50, organizationId } =
      params;
    const where: any = {};

    if (organizationId) {
      where.organizationId = organizationId;
    }

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const tokens = splitSearchTokens(search);
    if (tokens.length) {
      where.AND = tokens.map((token) => ({
        OR: [
          { name: { contains: token, mode: 'insensitive' } },
          { surname: { contains: token, mode: 'insensitive' } },
          { phone: { contains: token } },
          { email: { contains: token, mode: 'insensitive' } },
          { company: { contains: token, mode: 'insensitive' } },
        ],
      }));
    }

    if (tag) {
      where.tags = { has: tag };
    }

    const [contacts, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        include: { lead: true },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return { contacts, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: {
        lead: true,
        conversations: {
          include: {
            session: true,
            assignments: {
              where: { unassignedAt: null },
              include: {
                user: { select: { id: true, name: true, avatar: true } },
              },
            },
          },
          orderBy: { lastMessageAt: 'desc' },
        },
      },
    });
    if (!contact) throw new NotFoundException('Kişi bulunamadı');
    return contact;
  }

  async update(
    id: string,
    data: {
      name?: string;
      surname?: string;
      email?: string;
      tags?: string[];
      notes?: string;
      source?: string;
      company?: string;
      city?: string;
      address?: string;
      taxNumber?: string;
      identityNumber?: string;
      billingAddress?: string;
      shippingAddress?: string;
      metadata?: object;
    },
  ) {
    return this.prisma.contact.update({ where: { id }, data });
  }

  async addTag(id: string, tag: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundException('Kişi bulunamadı');
    const tags = contact.tags.includes(tag)
      ? contact.tags
      : [...contact.tags, tag];
    return this.prisma.contact.update({ where: { id }, data: { tags } });
  }

  async removeTag(id: string, tag: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundException('Kişi bulunamadı');
    const tags = contact.tags.filter((t) => t !== tag);
    return this.prisma.contact.update({ where: { id }, data: { tags } });
  }

  async delete(id: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundException('Kişi bulunamadı');
    await this.prisma.contact.delete({ where: { id } });
    return { message: 'Kişi silindi' };
  }

  async updateAvatar(id: string, avatarUrl: string) {
    return this.prisma.contact.update({
      where: { id },
      data: { avatarUrl },
    });
  }

  /**
   * Avatarı indir ve disk'e kaydet.
   * - Dosya adı telefon numarasından türetilir (sabit) → aynı kişi için tek dosya
   * - Yeni URL hash'i eskiyle aynıysa tekrar indirmez
   * - Yeni içerik varsa eski dosyayı sil, yenisini yaz
   */
  async downloadAndSaveAvatar(remoteUrl: string, phone: string, currentLocalPath?: string | null): Promise<string | null> {
    try {
      const dir = join(process.cwd(), 'uploads', 'avatars');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const response = await axios.get(remoteUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });

      const newBuffer = Buffer.from(response.data);
      const newHash = createHash('md5').update(newBuffer).digest('hex');

      // Aynı telefona ait tüm eski dosyaları bul ve kontrol et
      const safePhone = phone.replace(/\D/g, '');
      const prefix = `av_${safePhone}`;

      // Mevcut dosya aynı hash'e sahipse tekrar kaydetme
      if (currentLocalPath) {
        const existingPath = join(process.cwd(), currentLocalPath.replace(/^\//, ''));
        if (existsSync(existingPath)) {
          const { readFileSync } = await import('fs');
          const existingHash = createHash('md5').update(readFileSync(existingPath)).digest('hex');
          if (existingHash === newHash) {
            this.logger.debug(`Avatar değişmemiş, atlanıyor: ${safePhone}`);
            return currentLocalPath;
          }
        }
      }

      // Eski avatar dosyalarını temizle (aynı prefix'e sahip tüm dosyalar)
      try {
        const files = readdirSync(dir);
        for (const f of files) {
          if (f.startsWith(prefix)) {
            unlinkSync(join(dir, f));
          }
        }
      } catch { /* dizin okuma hatası görmezden gel */ }

      const contentType = response.headers['content-type'] || 'image/jpeg';
      const ext = contentType.includes('png') ? '.png' : '.jpg';
      const filename = `${prefix}${ext}`;
      const filePath = join(dir, filename);

      writeFileSync(filePath, newBuffer);
      this.logger.debug(`Avatar kaydedildi: ${filename}`);
      return `/uploads/avatars/${filename}`;
    } catch (err: any) {
      this.logger.debug(`Avatar indirilemedi (${phone}): ${err.message}`);
      return null;
    }
  }

  async fetchAndSaveProfilePicture(
    contactId: string,
    phone: string,
    profilePictureUrl: string | null,
  ): Promise<void> {
    if (!profilePictureUrl) return;

    try {
      // Mevcut avatarı al — hash karşılaştırması için
      const contact = await this.prisma.contact.findUnique({
        where: { id: contactId },
        select: { avatarUrl: true },
      });

      const localUrl = await this.downloadAndSaveAvatar(
        profilePictureUrl,
        phone,
        contact?.avatarUrl,
      );
      if (localUrl && localUrl !== contact?.avatarUrl) {
        await this.updateAvatar(contactId, localUrl);
      }
    } catch (err: any) {
      this.logger.debug(`Profil fotoğrafı kaydedilemedi (${phone}): ${err.message}`);
    }
  }

  /**
   * Tüm kişilerin avatarUrl'sini null yap ve disk'teki tüm avatar dosyalarını sil.
   * Sonraki sync'te numaraya göre yeniden indirilir.
   */
  async resetAllAvatars(): Promise<{ cleared: number; filesDeleted: number }> {
    // DB'yi temizle
    const result = await this.prisma.contact.updateMany({
      where: { avatarUrl: { not: null } },
      data: { avatarUrl: null },
    });

    // Disk'i temizle
    let filesDeleted = 0;
    try {
      const dir = join(process.cwd(), 'uploads', 'avatars');
      if (existsSync(dir)) {
        const files = readdirSync(dir);
        for (const f of files) {
          try { unlinkSync(join(dir, f)); filesDeleted++; } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }

    this.logger.log(`Avatar sıfırlama: ${result.count} DB kaydı, ${filesDeleted} dosya silindi`);
    return { cleared: result.count, filesDeleted };
  }

  normalizePhoneInput(raw: string): string {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (!digits) throw new BadRequestException('Telefon numarası gerekli');
    let d = digits;
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0') && d[1] === '5') d = `90${d.slice(1)}`;
    if (d.length === 10 && d.startsWith('5')) d = `90${d}`;
    if (d.length < 10 || d.length > 15) {
      throw new BadRequestException('Geçersiz telefon numarası');
    }
    return d;
  }

  /** WAHA profil fotoğrafı için telefon (ülke kodu ile, TR 0→90) */
  digitsForWahaProfile(phone: string): string | null {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (!digits) return null;
    let d = digits;
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0') && d[1] === '5') d = `90${d.slice(1)}`;
    if (d.length === 10 && d.startsWith('5')) d = `90${d}`;
    if (d.length < 10 || d.length > 15) return null;
    return d;
  }

  /**
   * Manuel kişi kaydı. sessionId verilirse ilgili oturumda görüşme satırı oluşturulur (sohbet açmak için).
   */
  async createContact(
    user: { role: string; organizationId?: string | null },
    dto: {
      phone: string;
      name?: string | null;
      surname?: string | null;
      email?: string | null;
      source?: string | null;
      notes?: string | null;
      company?: string | null;
      city?: string | null;
      address?: string | null;
      organizationId?: string | null;
      sessionId?: string | null;
    },
  ): Promise<{ contact: any; conversation: any | null }> {
    const phone = this.normalizePhoneInput(dto.phone);

    let organizationId: string | null = user.organizationId ?? null;
    if (user.role === 'SUPERADMIN') {
      if (!dto.organizationId?.trim()) {
        throw new BadRequestException('SUPERADMIN için organizationId zorunludur');
      }
      organizationId = dto.organizationId.trim();
    } else if (!organizationId) {
      throw new ForbiddenException('Organizasyon bulunamadı');
    }

    const convInclude = {
      contact: { include: { lead: true } },
      session: true,
      assignments: {
        where: { unassignedAt: null },
        include: {
          user: { select: { id: true, name: true, avatar: true } },
        },
      },
    } as const;

    try {
      const contact = await this.prisma.contact.create({
        data: {
          phone,
          name: dto.name?.trim() || null,
          surname: dto.surname?.trim() || null,
          email: dto.email?.trim() || null,
          source: dto.source?.trim() || null,
          notes: dto.notes?.trim() || null,
          company: dto.company?.trim() || null,
          city: dto.city?.trim() || null,
          address: dto.address?.trim() || null,
          organizationId,
        },
        include: { lead: true },
      });

      let conversation: any | null = null;
      if (dto.sessionId) {
        conversation = await this.prisma.conversation.upsert({
          where: {
            contactId_sessionId: { contactId: contact.id, sessionId: dto.sessionId },
          },
          update: {},
          create: { contactId: contact.id, sessionId: dto.sessionId },
          include: convInclude,
        });
      }

      return { contact, conversation };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Bu telefon numarası zaten kayıtlı');
      }
      throw e;
    }
  }
}
