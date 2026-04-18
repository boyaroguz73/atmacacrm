import { Injectable, Logger, BadRequestException, HttpException } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import type { TsoftIntegrationConfig, CreateTsoftSiteCustomerPayload } from './tsoft.types';

interface TokenEntry {
  token: string;
  expiresAt: number;
  apiRoot?: string;
  isRest1: boolean;
}

type LoginFlightResult = { ok: true; token: string } | { ok: false; error: HttpException };

@Injectable()
export class TsoftApiService {
  private readonly logger = new Logger(TsoftApiService.name);
  private readonly tokenCache = new Map<string, TokenEntry>();
  private readonly loginFlight = new Map<string, Promise<LoginFlightResult>>();
  private readonly rateLimitedUntil = new Map<string, number>();

  constructor(private prisma: PrismaService) {}

  private buildProxyConfig(targetUrl: string): {
    proxy?: {
      protocol: string;
      host: string;
      port: number;
      auth?: { username: string; password: string };
    };
  } {
    const isHttps = targetUrl.trim().toLowerCase().startsWith('https://');
    const raw =
      (isHttps
        ? process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
        : process.env.HTTP_PROXY || process.env.http_proxy) || '';
    if (!raw) return {};
    try {
      const u = new URL(raw);
      const protocol = u.protocol.replace(':', '');
      const port =
        Number(u.port) ||
        (u.protocol === 'https:' ? 443 : 80);
      const auth =
        u.username || u.password
          ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }
          : undefined;
      return {
        proxy: { protocol, host: u.hostname, port, ...(auth ? { auth } : {}) },
      };
    } catch {
      return {};
    }
  }

  private normalizeCredential(value: string): string {
    return String(value)
      .replace(/^\uFEFF|[\u200B\u200C\u200D\uFEFF]/g, '')
      .trim();
  }

  private normalizeBaseUrl(url: string): string {
    const raw = url.trim().replace(/\/+$/, '');
    const withProto = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
    try {
      const parsed = new URL(withProto);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return withProto;
    }
  }

  private summarizeTsoftError(status: number, data: unknown): string {
    if (data == null) return `HTTP ${status}`;
    if (typeof data === 'string') return data.slice(0, 280);
    const o = data as Record<string, unknown>;
    const msg = o.message ?? o.error ?? o.Message ?? o.statusMessage;
    if (typeof msg === 'string') return msg.slice(0, 280);
    const errs = o.errors;
    if (errs && typeof errs === 'object') {
      const flat = Object.values(errs as Record<string, unknown>)
        .flat()
        .filter((x) => typeof x === 'string')
        .join('; ');
      if (flat) return flat.slice(0, 280);
    }
    try {
      return JSON.stringify(data).slice(0, 280);
    } catch {
      return `HTTP ${status}`;
    }
  }

  /**
   * REST1 login yanıtında `data` bazen tek obje, bazen `[{ token, expirationTime, ... }]` dizisi gelir.
   */
  private loginDataRow(body: Record<string, unknown>): Record<string, unknown> {
    const d = body['data'];
    if (Array.isArray(d) && d.length > 0 && d[0] != null && typeof d[0] === 'object') {
      return d[0] as Record<string, unknown>;
    }
    if (d != null && typeof d === 'object' && !Array.isArray(d)) {
      return d as Record<string, unknown>;
    }
    return body;
  }

  private extractTokenFromLoginBody(body: Record<string, unknown>): string | null {
    const row = this.loginDataRow(body);
    const deep = row?.data as Record<string, unknown> | undefined;
    const result = body?.result as Record<string, unknown> | undefined;
    const candidates = [
      row?.token,
      row?.access_token,
      row?.accessToken,
      body?.token,
      body?.access_token,
      body?.accessToken,
      deep?.token,
      deep?.access_token,
      deep?.accessToken,
      result?.token,
      result?.access_token,
      result?.accessToken,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 10) return c;
    }
    return null;
  }

  async loadConfig(organizationId: string): Promise<TsoftIntegrationConfig> {
    const row = await this.prisma.orgIntegration.findUnique({
      where: {
        organizationId_integrationKey: { organizationId, integrationKey: 'tsoft' },
      },
    });
    if (!row?.isEnabled) {
      throw new BadRequestException('T-Soft entegrasyonu kapalı');
    }
    const c = (row.config || {}) as Partial<TsoftIntegrationConfig>;
    if (!c.baseUrl || !c.apiEmail || !c.apiPassword) {
      throw new BadRequestException('T-Soft mağaza URL ve API kullanıcı bilgileri eksik');
    }
    const pp = c.pathPrefix;
    const pathPrefix =
      pp === '/panel' || String(pp || '').toLowerCase() === 'panel' ? ('/panel' as const) : null;
    return {
      baseUrl: this.normalizeBaseUrl(String(c.baseUrl)),
      apiEmail: this.normalizeCredential(String(c.apiEmail)),
      apiPassword: this.normalizeCredential(String(c.apiPassword)),
      pathPrefix,
    };
  }

  clearTokenCache(organizationId: string) {
    this.tokenCache.delete(organizationId);
  }

  private resolveApiRoot(organizationId: string, cfg: TsoftIntegrationConfig): string {
    const hit = this.tokenCache.get(organizationId);
    if (hit?.apiRoot) return hit.apiRoot;
    if (cfg.pathPrefix === '/panel') return `${cfg.baseUrl}/panel`;
    return cfg.baseUrl;
  }

  clearRateLimitBlock(organizationId: string) {
    this.rateLimitedUntil.delete(organizationId);
  }

  private client(baseUrl: string, token?: string): AxiosInstance {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return axios.create({
      baseURL: baseUrl,
      timeout: 60_000,
      headers,
      ...this.buildProxyConfig(baseUrl),
      validateStatus: () => true,
    });
  }

  isRest1(organizationId: string): boolean {
    return this.tokenCache.get(organizationId)?.isRest1 ?? true;
  }

  async getBearerToken(organizationId: string): Promise<string> {
    const now = Date.now();
    const until = this.rateLimitedUntil.get(organizationId);
    if (until && until > now) {
      const sec = Math.ceil((until - now) / 1000);
      throw new BadRequestException(
        `T-Soft istek limiti: yaklaşık ${sec} sn bekleyin; sonra yalnızca bir kez deneyin.`,
      );
    }

    const cached = this.tokenCache.get(organizationId);
    if (cached && cached.expiresAt > now + 5000) {
      return cached.token;
    }

    const flying = this.loginFlight.get(organizationId);
    if (flying) {
      const r = await flying;
      if (!r.ok) throw r.error;
      return r.token;
    }

    const promise = this.performLogin(organizationId)
      .then((token): LoginFlightResult => ({ ok: true, token }))
      .catch((e): LoginFlightResult => {
        if (e instanceof HttpException) return { ok: false, error: e };
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: new BadRequestException(msg || 'T-Soft giriş hatası') };
      });
    this.loginFlight.set(organizationId, promise);
    promise.finally(() => this.loginFlight.delete(organizationId));

    const r = await promise;
    if (!r.ok) throw r.error;
    return r.token;
  }

  /**
   * REST1 login — T-Soft dokümantasyonundaki standart yöntem.
   * POST {baseUrl}/rest1/auth/login/{username}  body: pass=<password>
   */
  private async tryRest1Login(
    baseUrl: string,
    username: string,
    password: string,
  ): Promise<{ res: AxiosResponse; apiRoot: string } | null> {
    const encodedUser = encodeURIComponent(username);
    const loginPath = `/rest1/auth/login/${encodedUser}`;
    this.logger.debug(`T-Soft REST1 login: ${baseUrl}${loginPath}`);
    try {
      const http = this.client(baseUrl);
      const form = new URLSearchParams();
      form.set('pass', password);
      const r = await http.post(loginPath, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (r.status < 400) return { res: r, apiRoot: baseUrl };
      this.logger.debug(`T-Soft REST1 login HTTP ${r.status}`);
    } catch (e: any) {
      this.logger.debug(`T-Soft REST1 login ağ hatası: ${e?.message}`);
    }
    return null;
  }

  private async performLogin(organizationId: string): Promise<string> {
    const now = Date.now();
    const cfg = await this.loadConfig(organizationId);

    // Önce REST1 API'yi dene (T-Soft standart)
    const rest1 = await this.tryRest1Login(cfg.baseUrl, cfg.apiEmail, cfg.apiPassword);
    if (rest1) {
      const body = (rest1.res.data || {}) as Record<string, unknown>;
      const token = this.extractTokenFromLoginBody(body);
      if (token) {
        this.rateLimitedUntil.delete(organizationId);
        const inner = this.loginDataRow(body);
        let expiresAt: number;
        const expTimeStr = inner?.expirationTime ?? body?.expirationTime;
        if (typeof expTimeStr === 'string' && expTimeStr.length > 5) {
          let parsed = new Date(expTimeStr).getTime();
          if (!Number.isFinite(parsed)) {
            const m = expTimeStr.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
            if (m) {
              const [, dd, mm, yyyy, hh, mi, ss] = m;
              parsed = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`).getTime();
            }
          }
          expiresAt = Number.isFinite(parsed) && parsed > now ? parsed : now + 3600_000;
        } else {
          const ttlSec = Number(inner?.expires_in) || Number(body?.expires_in) || 3600;
          expiresAt = now + Math.max(60, ttlSec) * 1000;
        }
        this.tokenCache.set(organizationId, {
          token,
          expiresAt,
          apiRoot: rest1.apiRoot,
          isRest1: true,
        });
        this.logger.log(`T-Soft REST1 login başarılı (org=${organizationId})`);
        return token;
      }
      // REST1 HTTP 200 + success:true ama token parse edilemediyse v3'e düşmeyin (çoğu kurulumda v3 → 403 HTML)
      if (rest1.res.status >= 200 && rest1.res.status < 400) {
        const b = (rest1.res.data || {}) as Record<string, unknown>;
        if (b['success'] === true && !this.extractTokenFromLoginBody(b)) {
          this.logger.error(
            `T-Soft REST1: success=true fakat token çıkarılamadı. Yanıt örneği: ${JSON.stringify(rest1.res.data)?.slice(0, 400)}`,
          );
          throw new BadRequestException(
            'T-Soft REST1 giriş yanıtında token okunamadı. Backend sürümünü güncelleyin (rest1 auth data[] formatı) veya T-Soft yanıt formatını kontrol edin.',
          );
        }
      }
    }

    // REST1 başarısız → v3 API dene (fallback)
    const payload = { email: cfg.apiEmail, password: cfg.apiPassword };

    const postLogin = async (apiRoot: string): Promise<AxiosResponse> => {
      const http = this.client(apiRoot);
      let r = await http.post('/api/v3/admin/auth/login', payload);
      if (r.status === 415 || r.status === 406) {
        const form = new URLSearchParams();
        form.set('email', payload.email);
        form.set('password', payload.password);
        r = await http.post('/api/v3/admin/auth/login', form.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
      }
      return r;
    };

    let res: AxiosResponse;
    let apiRoot: string;

    try {
      if (cfg.pathPrefix === '/panel') {
        apiRoot = `${cfg.baseUrl}/panel`;
        this.logger.debug(`T-Soft login (panel): ${apiRoot}/api/v3/admin/auth/login`);
        res = await postLogin(apiRoot);
      } else {
        apiRoot = cfg.baseUrl;
        this.logger.debug(`T-Soft login: ${apiRoot}/api/v3/admin/auth/login`);
        res = await postLogin(apiRoot);
        if (res.status === 404) {
          const panelRoot = `${cfg.baseUrl}/panel`;
          this.logger.debug(`T-Soft login 404, panel deneniyor: ${panelRoot}`);
          apiRoot = panelRoot;
          res = await postLogin(panelRoot);
        }
      }
    } catch (err) {
      const ax = err as AxiosError;
      const code = ax.code || 'NETWORK';
      const detail = ax.message || String(err);
      this.logger.warn(`T-Soft login ağ hatası [${code}]: ${detail}`);
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
        throw new BadRequestException(
          `Mağazaya bağlanılamadı (${cfg.baseUrl}). Alan adını ve https:// kullanımını kontrol edin.`,
        );
      }
      throw new BadRequestException(`T-Soft'a erişilemedi: ${detail.slice(0, 200)}`);
    }

    const body = (res.data || {}) as Record<string, unknown>;

    if (res.status === 429) {
      this.rateLimitedUntil.set(organizationId, Date.now() + 180_000);
      throw new BadRequestException(
        `T-Soft çok sık istek (429). En az 2–3 dakika bekleyin.`,
      );
    }

    if (res.status === 401) {
      const hint = this.summarizeTsoftError(401, res.data);
      throw new BadRequestException(`T-Soft giriş reddedildi: ${hint}`);
    }

    if (res.status >= 400) {
      const hint = this.summarizeTsoftError(res.status, res.data);
      const v3Note =
        res.status === 403
          ? ' Bu mağazada v3 admin API genelde WAF ile engellenir; yalnızca REST1 kullanılmalı. Backend güncel mi ve REST1 token parse çalışıyor mu kontrol edin.'
          : '';
      throw new BadRequestException(`T-Soft giriş hatası (HTTP ${res.status}): ${hint}${v3Note}`);
    }

    const token = this.extractTokenFromLoginBody(body);
    if (!token) {
      throw new BadRequestException('T-Soft yanıtında token bulunamadı.');
    }

    this.rateLimitedUntil.delete(organizationId);
    const inner = (body?.data as Record<string, unknown>) || body;
    const ttlSec = Number(inner?.expires_in) || Number(body?.expires_in) || 3600;
    const expiresAt = now + Math.max(60, ttlSec) * 1000;
    this.tokenCache.set(organizationId, { token, expiresAt, apiRoot, isRest1: false });
    return token;
  }

  // ─── REST1 data request ───────────────────────────────────────────────

  /**
   * REST1 API isteği — token POST body'de gönderilir.
   * Tüm REST1 metodları POST kullanır.
   */
  async rest1Request<T = unknown>(
    organizationId: string,
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const token = await this.getBearerToken(organizationId);
    const cfg = await this.loadConfig(organizationId);
    const apiRoot = this.resolveApiRoot(organizationId, cfg);

    const form = new URLSearchParams();
    form.set('token', token);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) form.set(k, String(v));
      }
    }

    const fullUrl = `${apiRoot}${path}`;
    this.logger.debug(`[TSOFT-REST1] POST ${fullUrl}`);

    const http = this.client(apiRoot);
    let res = await http.post(path, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (res.status === 401) {
      this.logger.warn('[TSOFT-REST1] 401 — token yenileniyor...');
      this.clearTokenCache(organizationId);
      const newToken = await this.getBearerToken(organizationId);
      form.set('token', newToken);
      const newRoot = this.resolveApiRoot(organizationId, cfg);
      const http2 = this.client(newRoot);
      res = await http2.post(path, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    }

    this.logger.debug(
      `[TSOFT-REST1] POST ${fullUrl} → HTTP ${res.status} (${JSON.stringify(res.data)?.slice(0, 300)})`,
    );

    if (res.status >= 400) {
      throw new BadRequestException(
        `T-Soft API hatası (${res.status}): ${this.summarizeTsoftError(res.status, res.data)}`,
      );
    }

    return res.data as T;
  }

  /**
   * REST1 data dizisini JSON data param olarak gönderir (setCustomers vb.)
   */
  async rest1RequestWithData<T = unknown>(
    organizationId: string,
    path: string,
    data: unknown,
    extraParams?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const token = await this.getBearerToken(organizationId);
    const cfg = await this.loadConfig(organizationId);
    const apiRoot = this.resolveApiRoot(organizationId, cfg);

    const form = new URLSearchParams();
    form.set('token', token);
    form.set('data', JSON.stringify(data));
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        if (v !== undefined && v !== null) form.set(k, String(v));
      }
    }

    const fullUrl = `${apiRoot}${path}`;
    this.logger.debug(`[TSOFT-REST1] POST ${fullUrl} (data)`);

    const http = this.client(apiRoot);
    const res = await http.post(path, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    this.logger.debug(
      `[TSOFT-REST1] POST ${fullUrl} → HTTP ${res.status} (${JSON.stringify(res.data)?.slice(0, 300)})`,
    );

    if (res.status >= 400) {
      throw new BadRequestException(
        `T-Soft API hatası (${res.status}): ${this.summarizeTsoftError(res.status, res.data)}`,
      );
    }

    return res.data as T;
  }

  // ─── v3 API request (eski fallback) ───────────────────────────────────

  async v3Request<T>(
    organizationId: string,
    method: 'GET' | 'POST',
    path: string,
    options?: { params?: Record<string, string | number | undefined>; data?: unknown },
  ): Promise<T> {
    const cfg = await this.loadConfig(organizationId);
    const token = await this.getBearerToken(organizationId);
    const apiRoot = this.resolveApiRoot(organizationId, cfg);
    const http = this.client(apiRoot, token);

    const res = await http.request<T>({ method, url: path, params: options?.params, data: options?.data });

    if (res.status === 401) {
      this.clearTokenCache(organizationId);
      const retryToken = await this.getBearerToken(organizationId);
      const http2 = this.client(this.resolveApiRoot(organizationId, cfg), retryToken);
      const res2 = await http2.request<T>({ method, url: path, params: options?.params, data: options?.data });
      if (res2.status >= 400) {
        throw new BadRequestException(`T-Soft API hatası (${res2.status})`);
      }
      return res2.data;
    }

    if (res.status >= 400) {
      throw new BadRequestException(
        `T-Soft API hatası (${res.status}): ${this.summarizeTsoftError(res.status, res.data as unknown)}`,
      );
    }
    return res.data;
  }

  // ─── Unwrap helpers ───────────────────────────────────────────────────

  unwrapRest1List(data: unknown): { rows: Record<string, unknown>[]; total?: number } {
    const d = data as Record<string, unknown>;
    const arr = Array.isArray(d?.data) ? d.data : [];
    const rows = arr.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object');
    const summary = d?.summary as Record<string, unknown> | undefined;
    const total = summary?.totalRecordCount != null ? Number(summary.totalRecordCount) : undefined;
    return { rows, total };
  }

  // ─── Product endpoints ────────────────────────────────────────────────

  async listProducts(organizationId: string, page = 1, limit = 50) {
    if (this.isRest1(organizationId)) {
      const start = (page - 1) * limit;
      const raw = await this.rest1Request(organizationId, '/rest1/product/get/', {
        start,
        limit,
      });
      return this.unwrapRest1List(raw);
    }
    const data = await this.v3Request<unknown>(organizationId, 'GET', '/api/v3/admin/catalog/products', {
      params: { page, limit, sort: '-id' },
    });
    return this.unwrapV3List(data);
  }

  async listSubProducts(organizationId: string, mainProductCode: string) {
    const raw = await this.rest1Request(organizationId, '/rest1/product/get/', {
      ProductCode: mainProductCode,
      FetchSubProducts: 1,
    });
    const { rows } = this.unwrapRest1List(raw);
    if (rows.length === 0) return [];
    const product = rows[0];
    const subs = product.SubProducts;
    if (Array.isArray(subs)) return subs as Record<string, unknown>[];
    return [];
  }

  // ─── Order endpoints ──────────────────────────────────────────────────

  async listOrders(organizationId: string, page = 1, limit = 50) {
    if (this.isRest1(organizationId)) {
      const start = (page - 1) * limit;
      const raw = await this.rest1Request(organizationId, '/rest1/order/getOrders', {
        start,
        limit,
        FetchProductData: 1,
        FetchCustomerData: 1,
        FetchInvoiceAddress: 1,
        FetchDeliveryAddress: 1,
      });
      return this.unwrapRest1List(raw);
    }
    const data = await this.v3Request<unknown>(organizationId, 'GET', '/api/v3/admin/orders/order', {
      params: { page, limit, sort: '-id' },
    });
    return this.unwrapV3List(data);
  }

  async getOrderStatusList(organizationId: string) {
    const raw = await this.rest1Request(organizationId, '/rest1/order/getOrderStatusList');
    return this.unwrapRest1List(raw);
  }

  async createOrder(
    organizationId: string,
    orderData: Record<string, unknown>,
  ): Promise<unknown> {
    return this.rest1RequestWithData(
      organizationId,
      '/rest1/order2/createOrders',
      orderData,
    );
  }

  // ─── Customer endpoints ───────────────────────────────────────────────

  async listCustomersPage(organizationId: string, page = 1, limit = 100) {
    if (this.isRest1(organizationId)) {
      const start = (page - 1) * limit;
      const raw = await this.rest1Request(organizationId, '/rest1/customer/getCustomers', {
        start,
        limit,
      });
      return this.unwrapRest1List(raw);
    }
    const data = await this.v3Request<unknown>(organizationId, 'GET', '/api/v3/admin/customers/customer', {
      params: { page, limit, sort: '-id' },
    });
    return this.unwrapV3List(data);
  }

  async fetchAllCustomers(organizationId: string, maxPages = 50): Promise<Record<string, unknown>[]> {
    const all: Record<string, unknown>[] = [];
    for (let p = 1; p <= maxPages; p++) {
      const { rows } = await this.listCustomersPage(organizationId, p, 100);
      if (!rows.length) break;
      all.push(...rows);
      if (rows.length < 100) break;
    }
    return all;
  }

  async createCustomer(organizationId: string, payload: CreateTsoftSiteCustomerPayload) {
    if (this.isRest1(organizationId)) {
      const tsoftData = {
        CustomerCode: payload.email,
        Name: payload.name,
        Surname: payload.surname,
        Email: payload.email,
        Password: payload.password,
        Mobile: payload.mobilePhone,
        Phone: payload.mobilePhone,
        CompanyName: payload.company || '',
        Address: payload.address || '',
        Country: payload.countryCode || 'TR',
        City: payload.cityCode || '',
        Town: payload.townCode || '',
        IsEmailNotificationOn: payload.notification ? 1 : 0,
        IsSmsNotificationOn: payload.smsNotification ? 1 : 0,
      };
      return this.rest1RequestWithData(
        organizationId,
        '/rest1/customer/setCustomers',
        tsoftData,
      );
    }
    return this.v3Request<unknown>(organizationId, 'POST', '/api/v3/admin/customers/customer', {
      data: payload,
    });
  }

  // ─── Diagnose ─────────────────────────────────────────────────────────

  async diagnoseLogin(organizationId: string) {
    const cfg = await this.loadConfig(organizationId);
    const attempts: {
      loginUrl: string;
      httpStatus: number;
      message: string;
      tokenShapeOk: boolean;
    }[] = [];

    // REST1 test
    {
      const encodedUser = encodeURIComponent(cfg.apiEmail);
      const rest1Url = `${cfg.baseUrl}/rest1/auth/login/${encodedUser}`;
      try {
        const http = axios.create({
          baseURL: cfg.baseUrl,
          timeout: 15_000,
          headers: { Accept: 'application/json' },
          validateStatus: () => true,
        });
        const form = new URLSearchParams();
        form.set('pass', cfg.apiPassword);
        const r = await http.post(`/rest1/auth/login/${encodedUser}`, form.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const b = (r.data || {}) as Record<string, unknown>;
        const tokenShapeOk = r.status >= 200 && r.status < 300 && !!this.extractTokenFromLoginBody(b);
        attempts.push({
          loginUrl: rest1Url,
          httpStatus: r.status,
          message: this.summarizeTsoftError(r.status, r.data),
          tokenShapeOk,
        });
      } catch (e: any) {
        attempts.push({
          loginUrl: rest1Url,
          httpStatus: 0,
          message: `Bağlantı hatası: ${e?.message || 'sunucu yanıt vermedi'}`,
          tokenShapeOk: false,
        });
      }
    }

    // v3 API test (fallback)
    {
      const v3Url = `${cfg.baseUrl}/api/v3/admin/auth/login`;
      try {
        const http = axios.create({
          baseURL: cfg.baseUrl,
          timeout: 15_000,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          validateStatus: () => true,
        });
        const r = await http.post('/api/v3/admin/auth/login', {
          email: cfg.apiEmail,
          password: cfg.apiPassword,
        });
        const b = (r.data || {}) as Record<string, unknown>;
        const tokenShapeOk = r.status >= 200 && r.status < 300 && !!this.extractTokenFromLoginBody(b);
        attempts.push({
          loginUrl: v3Url,
          httpStatus: r.status,
          message: this.summarizeTsoftError(r.status, r.data),
          tokenShapeOk,
        });
      } catch (e: any) {
        attempts.push({
          loginUrl: v3Url,
          httpStatus: 0,
          message: `Bağlantı hatası: ${e?.message || 'sunucu yanıt vermedi'}`,
          tokenShapeOk: false,
        });
      }
    }

    const best = attempts.find((a) => a.tokenShapeOk);
    let note = 'Bu raporu T-Soft desteğine iletebilirsiniz.';
    if (best) {
      note = `Token alındı: ${best.loginUrl}`;
    } else if (attempts.some((a) => a.httpStatus === 429)) {
      note = '429: Bir süre bekleyin; teşhis de giriş isteği sayılır.';
    } else if (attempts.some((a) => a.httpStatus === 401)) {
      note = '401: API kullanıcı adı/şifre reddedildi.';
    }

    return {
      email: cfg.apiEmail,
      passwordLength: cfg.apiPassword.length,
      pathPrefixConfigured: cfg.pathPrefix === '/panel',
      attempts,
      note,
    };
  }

  // ─── v3 unwrap (eski) ────────────────────────────────────────────────

  private unwrapV3List(data: unknown): { rows: Record<string, unknown>[]; total?: number } {
    if (Array.isArray(data)) return { rows: data as Record<string, unknown>[] };
    const d = data as Record<string, unknown>;
    if (Array.isArray(d?.data)) return { rows: d.data as Record<string, unknown>[] };
    const inner = d?.data as Record<string, unknown> | undefined;
    if (inner && Array.isArray(inner.data)) return { rows: inner.data as Record<string, unknown>[] };
    if (inner && Array.isArray(inner.items)) return { rows: inner.items as Record<string, unknown>[] };
    return { rows: [] };
  }
}
