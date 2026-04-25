import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RawData, WebSocket } from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { EcommerceService } from './ecommerce.service';

type WsState = {
  socket: WebSocket;
  reconnectTimer: NodeJS.Timeout | null;
  syncTimer: NodeJS.Timeout | null;
  syncRunning: boolean;
  syncPending: boolean;
};

@Injectable()
export class TsoftOrderWebsocketListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TsoftOrderWebsocketListener.name);
  private readonly states = new Map<string, WsState>();
  private readonly refreshTimerMs = 60_000;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ecommerceService: EcommerceService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshConnections();
    this.refreshTimer = setInterval(() => {
      void this.refreshConnections();
    }, this.refreshTimerMs);
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    for (const orgId of this.states.keys()) {
      this.stopOrgListener(orgId);
    }
  }

  private parseWsConfig(rawConfig: unknown): {
    enabled: boolean;
    url: string | null;
    token: string | null;
    reconnectSeconds: number;
    lookbackMinutes: number;
  } {
    const config = rawConfig && typeof rawConfig === 'object' ? (rawConfig as Record<string, unknown>) : {};
    const enabled = config.orderWsEnabled === true;
    const url = String(config.orderWsUrl ?? '').trim() || null;
    const token = String(config.orderWsToken ?? '').trim() || null;
    const reconnectSeconds = Math.max(5, Number(config.orderWsReconnectSeconds ?? 15) || 15);
    const lookbackMinutes = Math.max(5, Number(config.orderWsLookbackMinutes ?? 90) || 90);
    return { enabled, url, token, reconnectSeconds, lookbackMinutes };
  }

  private async refreshConnections(): Promise<void> {
    const rows = await this.prisma.orgIntegration.findMany({
      where: { integrationKey: 'tsoft', isEnabled: true },
      select: { organizationId: true, config: true },
    });
    const enabledOrgIds = new Set<string>();

    for (const row of rows) {
      const wsCfg = this.parseWsConfig(row.config);
      if (!wsCfg.enabled || !wsCfg.url) {
        this.stopOrgListener(row.organizationId);
        continue;
      }
      const activeCfg = {
        url: wsCfg.url,
        token: wsCfg.token,
        reconnectSeconds: wsCfg.reconnectSeconds,
        lookbackMinutes: wsCfg.lookbackMinutes,
      };
      enabledOrgIds.add(row.organizationId);
      if (!this.states.has(row.organizationId)) {
        this.startOrgListener(row.organizationId, activeCfg);
      }
    }

    for (const orgId of this.states.keys()) {
      if (!enabledOrgIds.has(orgId)) this.stopOrgListener(orgId);
    }
  }

  private buildHeaders(token: string | null): Record<string, string> | undefined {
    if (!token) return undefined;
    return { Authorization: `Bearer ${token}` };
  }

  private startOrgListener(
    organizationId: string,
    cfg: { url: string; token: string | null; reconnectSeconds: number; lookbackMinutes: number },
  ): void {
    const socket = new WebSocket(cfg.url, {
      headers: this.buildHeaders(cfg.token),
    });
    const state: WsState = {
      socket,
      reconnectTimer: null,
      syncTimer: null,
      syncRunning: false,
      syncPending: false,
    };
    this.states.set(organizationId, state);

    socket.on('open', () => {
      this.logger.log(`[TSOFT-WS][org=${organizationId}] websocket bağlantısı açıldı`);
    });

    socket.on('message', (raw) => {
      const shouldSync = this.isOrderEvent(raw);
      if (!shouldSync) return;
      this.scheduleOrderSync(organizationId, cfg.lookbackMinutes);
    });

    socket.on('error', (err) => {
      this.logger.warn(
        `[TSOFT-WS][org=${organizationId}] websocket hata: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    socket.on('close', () => {
      const active = this.states.get(organizationId);
      if (!active) return;
      if (active.reconnectTimer) clearTimeout(active.reconnectTimer);
      active.reconnectTimer = setTimeout(() => {
        this.stopOrgListener(organizationId);
        this.startOrgListener(organizationId, cfg);
      }, cfg.reconnectSeconds * 1000);
      this.logger.warn(
        `[TSOFT-WS][org=${organizationId}] bağlantı kapandı, ${cfg.reconnectSeconds}sn sonra yeniden denenecek`,
      );
    });
  }

  private stopOrgListener(organizationId: string): void {
    const state = this.states.get(organizationId);
    if (!state) return;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    if (state.syncTimer) clearTimeout(state.syncTimer);
    try {
      state.socket.removeAllListeners();
      if (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING) {
        state.socket.close();
      }
    } catch {
      // no-op
    }
    this.states.delete(organizationId);
  }

  private isOrderEvent(raw: RawData): boolean {
    const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : '';
    if (!text) return false;
    try {
      const payload = JSON.parse(text) as Record<string, unknown>;
      const eventType = String(payload.type ?? payload.event ?? payload.action ?? '').toLowerCase();
      if (
        eventType.includes('order') &&
        (eventType.includes('new') || eventType.includes('create') || eventType.includes('added'))
      ) {
        return true;
      }
      if (payload.order || payload.orderId || payload.OrderId) return true;
      return false;
    } catch {
      const normalized = text.toLowerCase();
      return normalized.includes('order') && (normalized.includes('new') || normalized.includes('create'));
    }
  }

  private scheduleOrderSync(organizationId: string, lookbackMinutes: number): void {
    const state = this.states.get(organizationId);
    if (!state) return;
    if (state.syncTimer) clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(() => {
      void this.runOrderSync(organizationId, lookbackMinutes);
    }, 2500);
  }

  private async runOrderSync(organizationId: string, lookbackMinutes: number): Promise<void> {
    const state = this.states.get(organizationId);
    if (!state) return;
    if (state.syncRunning) {
      state.syncPending = true;
      return;
    }
    state.syncRunning = true;
    try {
      const admin = await this.prisma.user.findFirst({
        where: {
          organizationId,
          role: { in: ['SUPERADMIN', 'ADMIN'] } as any,
          isActive: true,
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!admin?.id) {
        this.logger.warn(`[TSOFT-WS][org=${organizationId}] aktif admin bulunamadı, sipariş sync atlandı`);
        return;
      }
      const dateEnd = new Date();
      const dateStart = new Date(dateEnd.getTime() - lookbackMinutes * 60 * 1000);
      const result = await this.ecommerceService.syncTsoftOrders(organizationId, admin.id, {
        dateStart,
        dateEnd,
      });
      this.logger.log(
        `[TSOFT-WS][org=${organizationId}] event-sync tamamlandı imported=${result.imported} existing=${result.skippedExisting} errors=${result.errors}`,
      );
    } catch (e) {
      this.logger.error(
        `[TSOFT-WS][org=${organizationId}] event-sync hatası: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      state.syncRunning = false;
      if (state.syncPending) {
        state.syncPending = false;
        this.scheduleOrderSync(organizationId, lookbackMinutes);
      }
    }
  }
}
