import { Injectable, Logger, BadRequestException, HttpException } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import type { TsoftIntegrationConfig, CreateTsoftSiteCustomerPayload } from './tsoft.types';

interface TokenEntry {
  token: string;
  expiresAt: number;
  /** Login’in yapıldığı tam kök (örn. https://site.com veya https://site.com/panel) */
  apiRoot?: string;
}

/** Paylaşılan login promise asla reject olmaz; süreç çökmesini ve çift tüketim uyarılarını önler */
type LoginFlightResult = { ok: true; token: string } | { ok: false; error: HttpException };

@Injectable()
export class TsoftApiService {
  private readonly logger = new Logger(TsoftApiService.name);
  private readonly tokenCache = new Map<string, TokenEntry>();
  /** Aynı org için eşzamanlı birden fazla login tek isteğe düşer */
  private readonly loginFlight = new Map<string, Promise<LoginFlightResult>>();
  /** T-Soft 429 sonrası bu süre dolana kadar yeni login denemesi yapılmaz */
  private readonly rateLimitedUntil = new Map<string, number>();

  constructor(private prisma: PrismaService) {}

  /**
   * Admin API mağaza kök domain üzerindedir. URL'ye /panel vb. yazılırsa
   * `/panel/api/v3/...` gibi hatalı istek oluşur — sadece origin kullanılır.
   */
  /** Kopyala-yapıştırda gelen BOM / zero-width karakterler; şifrede baş-son boşluk */
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
    const msg = o.message ?? o.error ?? o.Message;
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

  private extractTokenFromLoginBody(body: Record<string, unknown>): string | null {
    const inner = (body?.data as Record<string, unknown>) || body;
    const deep = inner?.data as Record<string, unknown> | undefined;
    const result = body?.result as Record<string, unknown> | undefined;
    const candidates = [
      inner?.token,
      inner?.access_token,
      inner?.accessToken,
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

  /** Geçerli T-Soft API kökü (login sonrası otomatik; yapılandırmada /panel zorunluysa oradan) */
  private resolveApiRoot(organizationId: string, cfg: TsoftIntegrationConfig): string {
    const hit = this.tokenCache.get(organizationId);
    if (hit?.apiRoot) return hit.apiRoot;
    if (cfg.pathPrefix === '/panel') return `${cfg.baseUrl}/panel`;
    return cfg.baseUrl;
  }

  /** Test / yapılandırma sonrası limit kilidini sıfırlamak için (isteğe bağlı) */
  clearRateLimitBlock(organizationId: string) {
    this.rateLimitedUntil.delete(organizationId);
  }

  private client(baseUrl: string, token?: string): AxiosInstance {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      // Bazı barındırma / WAF kuralları varsayılan axios istemcisini kısıtlayabiliyor
      'User-Agent': 'Mozilla/5.0 (compatible; AtmacaCRM/1.0; +https://developer.tsoft.com.tr/docs/api/)',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return axios.create({
      baseURL: baseUrl,
      timeout: 30_000,
      headers,
      validateStatus: () => true,
    });
  }

  /**
   * @see https://developer.tsoft.com.tr/docs/api/getting-started/authentication/
   */
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
   * REST1 API login — eski T-Soft sürümleri bu format kullanır.
   * POST {baseUrl}/rest1/auth/login/{username}  body: pass=<password>
   */
  private async tryRest1Login(
    baseUrl: string,
    username: string,
    password: string,
  ): Promise<{ res: AxiosResponse; apiRoot: string } | null> {
    const encodedUser = encodeURIComponent(username);
    const loginPath = `/rest1/auth/login/${encodedUser}`;
    this.logger.debug(`T-Soft REST1 login deneniyor: ${baseUrl}${loginPath}`);
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
        this.logger.debug(`T-Soft login (panel zorunlu): ${apiRoot}/api/v3/admin/auth/login`);
        res = await postLogin(apiRoot);
      } else {
        apiRoot = cfg.baseUrl;
        this.logger.debug(`T-Soft login: ${apiRoot}/api/v3/admin/auth/login`);
        res = await postLogin(apiRoot);
        if (res.status === 404) {
          const panelRoot = `${cfg.baseUrl}/panel`;
          this.logger.debug(`T-Soft login 404, panel kökü deneniyor: ${panelRoot}/api/v3/admin/auth/login`);
          apiRoot = panelRoot;
          res = await postLogin(panelRoot);
        }
      }

      // v3 login 404 döndüyse REST1 API'yi dene
      if (res.status === 404) {
        const rest1 = await this.tryRest1Login(cfg.baseUrl, cfg.apiEmail, cfg.apiPassword);
        if (rest1) {
          res = rest1.res;
          apiRoot = rest1.apiRoot;
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
      if (code === 'CERT_HAS_EXPIRED' || detail.toLowerCase().includes('certificate')) {
        throw new BadRequestException('Mağaza SSL sertifikası geçersiz veya güvenilmiyor.');
      }
      throw new BadRequestException(`T-Soft’a erişilemedi: ${detail.slice(0, 200)}`);
    }

    const body = (res.data || {}) as Record<string, unknown>;

    if (res.status === 429) {
      const hint = this.summarizeTsoftError(429, res.data);
      this.rateLimitedUntil.set(organizationId, Date.now() + 180_000);
      this.logger.warn(`T-Soft login 429: ${JSON.stringify(res.data)?.slice(0, 500)}`);
      throw new BadRequestException(
        `T-Soft çok sık istek (429): ${hint} En az 2–3 dakika bekleyin; ardından yalnızca bir kez «Bağlantıyı test et». Kenar çubuğu / gelen kutusu arka planda tekrar denemez (10 dk).`,
      );
    }

    if (res.status === 401) {
      const hint = this.summarizeTsoftError(401, res.data);
      this.logger.warn(`T-Soft login HTTP 401: ${JSON.stringify(res.data)?.slice(0, 500)}`);
      throw new BadRequestException(
        `${hint || 'Giriş reddedildi.'} Mağaza URL’si panelle aynı kök alan adı olmalı (www kullanıyorsanız CRM’de de www). API kullanıcısı, yönetici hesabından farklıdır. Şifreyi CRM’de yeniden yazıp Kaydet. Sık deneme 429 tetikler. api-support@tsoft.com.tr`,
      );
    }

    if (res.status === 428) {
      const hint = this.summarizeTsoftError(428, res.data);
      this.logger.warn(`T-Soft login HTTP 428: ${JSON.stringify(res.data)?.slice(0, 500)}`);
      throw new BadRequestException(
        `T-Soft giriş tamamlanmadı — sunucu «${hint || 'please validate'}» döndü (bazı kurulumlarda HTTP 428; resmi API dokümantasyonunda bu kod açıklanmayabilir). ` +
          `Panelden bu API kullanıcısı / mağaza için e-posta, güvenlik veya cihaz doğrulamasını tamamlayın. Devam ederse yanıt gövdesiyle api-support@tsoft.com.tr.`,
      );
    }

    if (res.status >= 400) {
      const hint = this.summarizeTsoftError(res.status, res.data);
      this.logger.warn(`T-Soft login HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 500)}`);
      const panelHint =
        res.status === 404 && cfg.pathPrefix !== '/panel'
          ? ' Entegrasyon ayarından «API /panel altında» seçeneğini işaretleyip tekrar deneyin.'
          : '';
      throw new BadRequestException(
        `T-Soft giriş reddedildi (HTTP ${res.status}): ${hint}. Mağaza kök adresi ve API kullanıcısı doğrulanmalı.${panelHint}`,
      );
    }

    const successFlag = body.success;
    if (successFlag === false) {
      const hint = this.summarizeTsoftError(res.status, body);
      this.logger.warn(`T-Soft login success=false: ${JSON.stringify(body)?.slice(0, 500)}`);
      throw new BadRequestException(`T-Soft giriş başarısız: ${hint}`);
    }

    const token = this.extractTokenFromLoginBody(body);

    if (!token) {
      this.logger.warn(`T-Soft token parse edilemedi: ${JSON.stringify(body)?.slice(0, 400)}`);
      throw new BadRequestException(
        'T-Soft yanıtında token bulunamadı. Yanıt yapısı beklenenden farklı olabilir; T-Soft destek veya panel API sürümünü doğrulayın.',
      );
    }

    this.rateLimitedUntil.delete(organizationId);

    const inner = (body?.data as Record<string, unknown>) || body;

    // REST1: expirationTime = tarih string; v3: expires_in = saniye
    let expiresAt: number;
    const expTimeStr = inner?.expirationTime ?? body?.expirationTime;
    if (typeof expTimeStr === 'string' && expTimeStr.length > 5) {
      const parsed = new Date(expTimeStr).getTime();
      expiresAt = Number.isFinite(parsed) && parsed > now ? parsed : now + 3600_000;
    } else {
      const ttlSec =
        Number(inner?.expires_in) ||
        Number(inner?.expiresIn) ||
        Number(body?.expires_in) ||
        3600;
      expiresAt = now + Math.max(60, ttlSec) * 1000;
    }
    this.tokenCache.set(organizationId, { token, expiresAt, apiRoot });
    return token;
  }

  /**
   * Tek seferlik teşhis: önbelleğe token yazmaz. T-Soft tarafında limiti tetikleyebilir; günde birkaç kez kullanın.
   */
  async diagnoseLogin(organizationId: string): Promise<{
    email: string;
    passwordLength: number;
    pathPrefixConfigured: boolean;
    attempts: { loginUrl: string; httpStatus: number; message: string; tokenShapeOk: boolean }[];
    note: string;
  }> {
    const cfg = await this.loadConfig(organizationId);
    const payload = { email: cfg.apiEmail, password: cfg.apiPassword };
    const attempts: {
      loginUrl: string;
      httpStatus: number;
      message: string;
      tokenShapeOk: boolean;
    }[] = [];

    const probe = async (apiRoot: string) => {
      const http = axios.create({
        baseURL: apiRoot,
        timeout: 15_000,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
      try {
        let r = await http.post('/api/v3/admin/auth/login', payload);
        if (r.status === 415 || r.status === 406) {
          const form = new URLSearchParams();
          form.set('email', payload.email);
          form.set('password', payload.password);
          r = await http.post('/api/v3/admin/auth/login', form.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          });
        }
        const b = (r.data || {}) as Record<string, unknown>;
        const tokenShapeOk =
          r.status >= 200 && r.status < 300 && !!this.extractTokenFromLoginBody(b);
        attempts.push({
          loginUrl: `${apiRoot}/api/v3/admin/auth/login`,
          httpStatus: r.status,
          message: this.summarizeTsoftError(r.status, r.data),
          tokenShapeOk,
        });
        return r.status;
      } catch (e: any) {
        attempts.push({
          loginUrl: `${apiRoot}/api/v3/admin/auth/login`,
          httpStatus: 0,
          message: `Bağlantı hatası: ${e?.message || 'sunucu yanıt vermedi'}`,
          tokenShapeOk: false,
        });
        return 0;
      }
    };

    if (cfg.pathPrefix === '/panel') {
      await probe(`${cfg.baseUrl}/panel`);
    } else {
      const s = await probe(cfg.baseUrl);
      if (s === 404) await probe(`${cfg.baseUrl}/panel`);
    }

    // REST1 API de dene (eski T-Soft sürümleri)
    {
      const encodedUser = encodeURIComponent(cfg.apiEmail);
      const rest1Url = `${cfg.baseUrl}/rest1/auth/login/${encodedUser}`;
      try {
        const http = this.client(cfg.baseUrl);
        const form = new URLSearchParams();
        form.set('pass', cfg.apiPassword);
        const r = await http.post(`/rest1/auth/login/${encodedUser}`, form.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const b = (r.data || {}) as Record<string, unknown>;
        const tokenShapeOk =
          r.status >= 200 && r.status < 300 && !!this.extractTokenFromLoginBody(b);
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
          message: `Ağ hatası: ${e?.message || 'bağlantı yok'}`,
          tokenShapeOk: false,
        });
      }
    }

    const last = attempts[attempts.length - 1];
    let note =
      'Bu raporu T-Soft desteğine iletebilirsiniz. Şifre burada saklanmaz; yalnızca uzunluk gösterilir.';
    if (last?.httpStatus === 429) {
      note = '429: Bir süre bekleyin; teşhis de giriş isteği sayılır.';
    } else if (last?.httpStatus === 401) {
      note =
        '401: T-Soft sunucusu kimliği reddetti. Paneldeki API kullanıcısı ile aynı e-posta/şifre olduğundan ve mağaza URL’sinin doğru olduğundan emin olun.';
    } else if (last?.httpStatus === 428) {
      note =
        'T-Soft «please validate / doğrulama» yanıtı verdi; panelden ilgili hesap güvenlik adımlarını tamamlayın. Bazı mağazalarda HTTP 428 ile gelir — dokümanda kod olmayabilir, tam JSON yanıtı T-Soft desteğine iletin.';
    } else if (last?.tokenShapeOk) {
      note = 'HTTP 2xx ve yanıtta token alanı algılandı; «Bağlantıyı test et» bu yapılandırmayı kullanmalı.';
    }

    return {
      email: cfg.apiEmail,
      passwordLength: cfg.apiPassword.length,
      pathPrefixConfigured: cfg.pathPrefix === '/panel',
      attempts,
      note,
    };
  }

  async request<T>(
    organizationId: string,
    method: 'GET' | 'POST',
    path: string,
    options?: { params?: Record<string, string | number | undefined>; data?: unknown; skipAuth?: boolean },
  ): Promise<T> {
    const cfg = await this.loadConfig(organizationId);
    const token = options?.skipAuth ? undefined : await this.getBearerToken(organizationId);
    const apiRoot = this.resolveApiRoot(organizationId, cfg);
    const http = this.client(apiRoot, token);

    const fullUrl = `${apiRoot}${path}`;
    this.logger.debug(`[TSOFT-API] ${method} ${fullUrl} params=${JSON.stringify(options?.params || {})}`);

    const res = await http.request<T>({
      method,
      url: path,
      params: options?.params,
      data: options?.data,
    });

    this.logger.debug(`[TSOFT-API] ${method} ${fullUrl} → HTTP ${res.status} (${typeof res.data === 'object' ? JSON.stringify(res.data)?.slice(0, 200) : String(res.data).slice(0, 200)})`);

    if (res.status === 401) {
      this.logger.warn(`[TSOFT-API] 401 — token yenileniyor...`);
      this.clearTokenCache(organizationId);
      const retryToken = await this.getBearerToken(organizationId);
      const http2 = this.client(this.resolveApiRoot(organizationId, cfg), retryToken);
      const res2 = await http2.request<T>({
        method,
        url: path,
        params: options?.params,
        data: options?.data,
      });
      this.logger.debug(`[TSOFT-API] Retry ${method} ${fullUrl} → HTTP ${res2.status}`);
      if (res2.status >= 400) {
        throw new BadRequestException(
          `T-Soft API hatası (${res2.status}): ${JSON.stringify(res2.data)?.slice(0, 300)}`,
        );
      }
      return res2.data;
    }

    if (res.status >= 400) {
      this.logger.error(`[TSOFT-API] Hata ${method} ${fullUrl}: HTTP ${res.status} — ${JSON.stringify(res.data)?.slice(0, 500)}`);
      throw new BadRequestException(
        `T-Soft API hatası (${res.status}): ${JSON.stringify(res.data)?.slice(0, 300)}`,
      );
    }

    return res.data as T;
  }

  unwrapList(data: unknown): { rows: unknown[]; raw: unknown } {
    if (Array.isArray(data)) return { rows: data, raw: data };
    const d = data as Record<string, unknown>;
    if (Array.isArray(d?.data)) return { rows: d.data as unknown[], raw: data };
    const inner = d?.data as Record<string, unknown> | undefined;
    if (inner && Array.isArray(inner.data)) return { rows: inner.data as unknown[], raw: data };
    if (inner && Array.isArray(inner.items)) return { rows: inner.items as unknown[], raw: data };
    return { rows: [], raw: data };
  }

  /**
   * @see https://developer.tsoft.com.tr/docs/api/product/
   */
  async listProducts(organizationId: string, page = 1, limit = 50) {
    const data = await this.request<unknown>(organizationId, 'GET', '/api/v3/admin/catalog/products', {
      params: { page, limit, sort: '-id' },
    });
    return this.unwrapList(data);
  }

  /**
   * @see https://developer.tsoft.com.tr/docs/api/order/
   */
  async listOrders(organizationId: string, page = 1, limit = 50) {
    const data = await this.request<unknown>(organizationId, 'GET', '/api/v3/admin/orders/order', {
      params: { page, limit, sort: '-id' },
    });
    return this.unwrapList(data);
  }

  /**
   * @see https://developer.tsoft.com.tr/docs/api/customer/
   */
  async listCustomersPage(organizationId: string, page = 1, limit = 100) {
    const data = await this.request<unknown>(organizationId, 'GET', '/api/v3/admin/customers/customer', {
      params: { page, limit, sort: '-id' },
    });
    return this.unwrapList(data);
  }

  async fetchAllCustomers(organizationId: string, maxPages = 50): Promise<Record<string, unknown>[]> {
    const all: Record<string, unknown>[] = [];
    for (let p = 1; p <= maxPages; p++) {
      const { rows } = await this.listCustomersPage(organizationId, p, 100);
      if (!rows.length) break;
      for (const r of rows) {
        if (r && typeof r === 'object') all.push(r as Record<string, unknown>);
      }
      if (rows.length < 100) break;
    }
    return all;
  }

  async createCustomer(organizationId: string, payload: CreateTsoftSiteCustomerPayload) {
    return this.request<unknown>(organizationId, 'POST', '/api/v3/admin/customers/customer', {
      data: payload,
    });
  }
}
