import { AppConfig } from "../config.js";
import { FeishuApiError } from "./api-error.js";
import { FeishuAuthClient } from "./auth.js";

type AiResponse = {
  code: number;
  msg?: string;
  data?: {
    answer?: string;
  };
};

export class FeishuAiClient {
  private readonly config: AppConfig;
  private readonly authClient: FeishuAuthClient;

  constructor(config: AppConfig, authClient: FeishuAuthClient) {
    this.config = config;
    this.authClient = authClient;
  }

  async expandBugDescription(bugTitle: string, bugDescription?: string): Promise<string> {
    const prompt = this.buildExpandPrompt(bugTitle, bugDescription);
    
    try {
      const payload = await this.request<AiResponse>(
        `${this.config.baseUrl}/ai/question_and_answer/v1/ask`,
        {
          method: "POST",
          body: JSON.stringify({
            question: prompt
          })
        }
      );

      if (payload.code !== 0 || !payload.data?.answer) {
        throw new Error(payload.msg || "AI扩写请求失败");
      }

      const expanded = payload.data.answer.trim();
      return this.trimResponse(expanded);
    } catch (error) {
      console.warn(`AI扩写失败，使用原始描述: ${error instanceof Error ? error.message : "未知错误"}`);
      return bugDescription || bugTitle;
    }
  }

  private buildExpandPrompt(title: string, description?: string): string {
    const basePrompt = "请帮我详细扩写以下bug描述，使其更加完整和清晰：\n\n";
    const titlePart = `标题：${title}\n`;
    const descPart = description ? `描述：${description}\n` : "";
    const instruction = "\n请按照以下结构扩写：\n1. 问题概述\n2. 可能的原因分析\n3. 影响范围\n4. 建议的修复方向";
    
    return basePrompt + titlePart + descPart + instruction;
  }

  private trimResponse(response: string): string {
    const maxLength = 2000;
    if (response.length <= maxLength) {
      return response;
    }
    return response.substring(0, maxLength) + "...（内容已截断）";
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const token = await this.authClient.getTenantAccessToken();
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      const payload = await this.safeParseJson(response);
      const message =
        this.extractMessage(payload) ?? `Feishu AI API request failed with status ${response.status}`;
      throw new FeishuApiError(message, {
        status: response.status,
        responseCode: this.extractCode(payload),
        responseBody: payload
      });
    }

    return (await response.json()) as T;
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