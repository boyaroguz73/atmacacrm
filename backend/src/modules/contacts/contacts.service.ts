import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { v4 as uuid } from 'uuid';
import axios from 'axios';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(private prisma: PrismaService) {}

  async findOrCreate(phone: string, name?: string) {
    return this.prisma.contact.upsert({
      where: { phone },
      update: {},
      create: { phone, name: name || phone },
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

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { surname: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
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
          include: { session: true },
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

  async downloadAndSaveAvatar(remoteUrl: string, phone: string): Promise<string | null> {
    try {
      const dir = join(process.cwd(), 'uploads', 'avatars');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const response = await axios.get(remoteUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });

      const contentType = response.headers['content-type'] || 'image/jpeg';
      const ext = contentType.includes('png') ? '.png' : '.jpg';
      const filename = `${phone}-${uuid().slice(0, 8)}${ext}`;
      const filePath = join(dir, filename);

      writeFileSync(filePath, Buffer.from(response.data));
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
      const localUrl = await this.downloadAndSaveAvatar(profilePictureUrl, phone);
      if (localUrl) {
        await this.updateAvatar(contactId, localUrl);
      }
    } catch (err: any) {
      this.logger.debug(`Profil fotoğrafı kaydedilemedi (${phone}): ${err.message}`);
    }
  }
}
