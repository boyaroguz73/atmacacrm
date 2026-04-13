import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService implements OnModuleInit {
  private cache = new Map<string, string>();

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadAll();
  }

  private async loadAll() {
    const all = await this.prisma.systemSetting.findMany();
    this.cache.clear();
    for (const s of all) this.cache.set(s.key, s.value);
  }

  async get(key: string): Promise<string | null> {
    if (this.cache.has(key)) return this.cache.get(key)!;
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (row) {
      this.cache.set(key, row.value);
      return row.value;
    }
    return null;
  }

  async set(key: string, value: string) {
    const result = await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    this.cache.set(key, value);
    return result;
  }

  async getAll() {
    return this.prisma.systemSetting.findMany();
  }

  async isInternalChatEnabled(): Promise<boolean> {
    const val = await this.get('internal_chat_enabled');
    return val === 'true';
  }
}
