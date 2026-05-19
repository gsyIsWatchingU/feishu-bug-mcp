import { AppConfig } from "../config.js";

type TenantTokenResponse = {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
};

export class FeishuAuthClient {
  private readonly config: AppConfig;
  private cachedToken?: string;
  private expiresAt = 0;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.expiresAt - 60_000) {
      return this.cachedToken;
    }

    const response = await fetch(
      `${this.config.baseUrl}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Feishu auth request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as TenantTokenResponse;
    if (payload.code !== 0 || !payload.tenant_access_token || !payload.expire) {
      throw new Error(payload.msg || "Failed to obtain tenant access token");
    }

    this.cachedToken = payload.tenant_access_token;
    this.expiresAt = now + payload.expire * 1000;
    return this.cachedToken;
  }
}
