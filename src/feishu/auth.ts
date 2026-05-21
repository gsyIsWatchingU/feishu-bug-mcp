import { AppConfig } from "../config.js";
import { FeishuApiError } from "./api-error.js";

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
      const payload = await this.safeParseJson(response);
      const message =
        this.extractMessage(payload) ?? `Feishu auth request failed with status ${response.status}`;
      throw new FeishuApiError(message, {
        status: response.status,
        responseCode: this.extractCode(payload),
        responseBody: payload
      });
    }

    const payload = (await response.json()) as TenantTokenResponse;
    if (payload.code !== 0 || !payload.tenant_access_token || !payload.expire) {
      throw new Error(payload.msg || "Failed to obtain tenant access token");
    }

    this.cachedToken = payload.tenant_access_token;
    this.expiresAt = now + payload.expire * 1000;
    return this.cachedToken;
  }

  private async safeParseJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return await response.text();
    }
  }

  private extractMessage(payload: unknown): string | undefined {
    if (!payload || typeof payload !== "object") {
      return undefined;
    }

    const message = (payload as { msg?: unknown; message?: unknown }).msg ??
      (payload as { msg?: unknown; message?: unknown }).message;
    return typeof message === "string" && message.trim().length > 0 ? message : undefined;
  }

  private extractCode(payload: unknown): number | undefined {
    if (!payload || typeof payload !== "object") {
      return undefined;
    }

    const code = (payload as { code?: unknown }).code;
    return typeof code === "number" ? code : undefined;
  }
}
