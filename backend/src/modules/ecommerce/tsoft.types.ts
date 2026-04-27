export interface TsoftIntegrationConfig {
  baseUrl: string;
  apiEmail: string;
  apiPassword: string;
  /** Bazı mağazalarda Admin API kökü https://alanadiniz/panel olur */
  pathPrefix?: '/panel' | null;
  /** T-Soft sipariş event websocket adresi (opsiyonel) */
  orderWsUrl?: string;
  /** Bearer/JWT gibi auth token (opsiyonel) */
  orderWsToken?: string;
  /** Websocket dinleyicisi aktif/pasif */
  orderWsEnabled?: boolean;
  /** Yeniden bağlanma aralığı (sn) */
  orderWsReconnectSeconds?: number;
  /** Event geldiğinde kaç dk geriye dönük sipariş çekilecek */
  orderWsLookbackMinutes?: number;
}

/** orgIntegration.config.sync içinde saklanan bayraklar + sipariş tarih sınırı */
export interface TsoftOrgSyncConfig {
  orders?: boolean;
  products?: boolean;
  customers?: boolean;
  images?: boolean;
  variants?: boolean;
  push?: boolean;
  cartAbandonTasks?: boolean;
  /** YYYY-MM-DD — sipariş çekiminde başlangıç bu günden önceye inemez */
  ordersPullSince?: string;
}

export interface CreateTsoftSiteCustomerPayload {
  name: string;
  surname: string;
  email: string;
  password: string;
  mobilePhone: string;
  company?: string;
  address?: string;
  countryCode?: string;
  cityCode?: string;
  districtCode?: string;
  provinceCode?: string;
  townCode?: string;
  notification?: boolean;
  smsNotification?: boolean;
}
