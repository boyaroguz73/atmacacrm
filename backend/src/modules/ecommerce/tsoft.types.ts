export interface TsoftIntegrationConfig {
  baseUrl: string;
  apiEmail: string;
  apiPassword: string;
  /** Bazı mağazalarda Admin API kökü https://alanadiniz/panel olur */
  pathPrefix?: '/panel' | null;
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
