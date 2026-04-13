import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SystemService {
  constructor(private prisma: PrismaService) {}

  async getMetrics() {
    const [
      cpuInfo,
      memInfo,
      diskInfo,
      messageStats,
      dbCounts,
      sessionStats,
      orgStats,
    ] = await Promise.all([
      this.getCpuInfo(),
      this.getMemoryInfo(),
      this.getDiskInfo(),
      this.getMessageStats(),
      this.getDbCounts(),
      this.getSessionStats(),
      this.getOrgStats(),
    ]);

    return {
      cpu: cpuInfo,
      memory: memInfo,
      disk: diskInfo,
      messages: messageStats,
      database: dbCounts,
      sessions: sessionStats,
      organizations: orgStats,
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: `${os.platform()} ${os.arch()}`,
    };
  }

  private getCpuInfo() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type of Object.keys(cpu.times) as (keyof typeof cpu.times)[]) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }

    const usagePercent = totalTick > 0
      ? Math.round(((totalTick - totalIdle) / totalTick) * 100)
      : 0;

    return {
      cores: cpus.length,
      model: cpus[0]?.model || 'Unknown',
      usagePercent,
      loadAvg: loadAvg.map((l) => Math.round(l * 100) / 100),
    };
  }

  private getMemoryInfo() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const processMemory = process.memoryUsage();

    return {
      totalGB: Math.round((total / 1073741824) * 100) / 100,
      usedGB: Math.round((used / 1073741824) * 100) / 100,
      freeGB: Math.round((free / 1073741824) * 100) / 100,
      usagePercent: Math.round((used / total) * 100),
      processRSS_MB: Math.round(processMemory.rss / 1048576),
      processHeap_MB: Math.round(processMemory.heapUsed / 1048576),
    };
  }

  private getDiskInfo() {
    try {
      const uploadsPath = path.join(process.cwd(), 'uploads');
      let uploadsSizeMB = 0;

      if (fs.existsSync(uploadsPath)) {
        uploadsSizeMB = this.getDirSize(uploadsPath) / 1048576;
      }

      return {
        uploadsSizeMB: Math.round(uploadsSizeMB * 100) / 100,
      };
    } catch {
      return { uploadsSizeMB: 0 };
    }
  }

  private getDirSize(dirPath: string): number {
    let size = 0;
    try {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          size += this.getDirSize(filePath);
        } else {
          size += stat.size;
        }
      }
    } catch { /* ignore */ }
    return size;
  }

  private async getMessageStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayIncoming, todayOutgoing, totalMessages] = await Promise.all([
      this.prisma.message.count({
        where: { direction: 'INCOMING', createdAt: { gte: today } },
      }),
      this.prisma.message.count({
        where: { direction: 'OUTGOING', createdAt: { gte: today } },
      }),
      this.prisma.message.count(),
    ]);

    return {
      todayIncoming,
      todayOutgoing,
      todayTotal: todayIncoming + todayOutgoing,
      totalMessages,
    };
  }

  private async getDbCounts() {
    const [messages, conversations, contacts, users, organizations] =
      await Promise.all([
        this.prisma.message.count(),
        this.prisma.conversation.count(),
        this.prisma.contact.count(),
        this.prisma.user.count(),
        this.prisma.organization.count(),
      ]);

    return { messages, conversations, contacts, users, organizations };
  }

  private async getSessionStats() {
    const sessions = await this.prisma.whatsappSession.findMany({
      select: { id: true, name: true, status: true, phone: true, organizationId: true },
    });

    return {
      total: sessions.length,
      working: sessions.filter((s) => s.status === 'WORKING').length,
      stopped: sessions.filter((s) => s.status === 'STOPPED').length,
      sessions,
    };
  }

  private async getOrgStats() {
    const planDistribution = await this.prisma.organization.groupBy({
      by: ['plan'],
      _count: true,
    });

    const activeOrgs = await this.prisma.organization.count({
      where: { isActive: true },
    });

    const totalOrgs = await this.prisma.organization.count();

    const trialOrgs = await this.prisma.subscription.count({
      where: { status: 'TRIALING' },
    });

    const paidOrgs = await this.prisma.subscription.count({
      where: { status: 'ACTIVE' },
    });

    return {
      total: totalOrgs,
      active: activeOrgs,
      trial: trialOrgs,
      paid: paidOrgs,
      planDistribution: planDistribution.map((p) => ({
        plan: p.plan,
        count: p._count,
      })),
    };
  }
}
