import { AppConfig } from "../config.js";
import {
  BitableListResult,
  FeishuRecord,
  ListBugFilters,
  NormalizedBug
} from "../types.js";
import { FeishuAuthClient } from "./auth.js";

type FeishuListResponse = {
  code: number;
  msg?: string;
  data?: {
    has_more?: boolean;
    page_token?: string;
    total?: number;
    items?: FeishuRecord[];
  };
};

type FeishuGetResponse = {
  code: number;
  msg?: string;
  data?: {
    record?: FeishuRecord;
  };
};

type FeishuUpdateResponse = {
  code: number;
  msg?: string;
  data?: {
    record?: FeishuRecord;
  };
};

export class FeishuBitableClient {
  private readonly config: AppConfig;
  private readonly authClient: FeishuAuthClient;

  constructor(config: AppConfig, authClient: FeishuAuthClient) {
    this.config = config;
    this.authClient = authClient;
  }

  async listAllRecords(): Promise<BitableListResult> {
    const items: FeishuRecord[] = [];
    let pageToken: string | undefined;
    let hasMore = true;
    let total = 0;

    while (hasMore) {
      const payload = await this.request<FeishuListResponse>(
        this.buildRecordUrl(pageToken),
        { method: "GET" }
      );

      if (payload.code !== 0) {
        throw new Error(payload.msg || "Failed to list Feishu Bitable records");
      }

      const pageItems = payload.data?.items ?? [];
      items.push(...pageItems);
      total = payload.data?.total ?? items.length;
      hasMore = Boolean(payload.data?.has_more);
      pageToken = payload.data?.page_token;
    }

    return {
      items,
      total
    };
  }

  async getRecordByBugId(bugId: string): Promise<FeishuRecord | null> {
    const listed = await this.listAllRecords();
    const mapping = this.config.fieldMapping.bugId;
    return (
      listed.items.find((item) => this.getComparableValue(item.fields[mapping]) === bugId) ??
      null
    );
  }

  async updateRecord(recordId: string, fields: Record<string, unknown>): Promise<FeishuRecord> {
    const payload = await this.request<FeishuUpdateResponse>(
      `${this.baseRecordUrl()}/${recordId}`,
      {
        method: "PUT",
        body: JSON.stringify({ fields })
      }
    );

    if (payload.code !== 0 || !payload.data?.record) {
      throw new Error(payload.msg || "Failed to update Feishu Bitable record");
    }

    return payload.data.record;
  }

  normalizeAndOrderBugs(records: FeishuRecord[], filters?: ListBugFilters): NormalizedBug[] {
    const bugs = records.map((record) => this.normalizeBug(record));
    const filtered = bugs.filter((bug) => {
      if (filters?.status && bug.status !== filters.status) {
        return false;
      }
      if (filters?.assignee && bug.assignee !== filters.assignee) {
        return false;
      }
      if (filters?.priority && bug.priority !== filters.priority) {
        return false;
      }
      return true;
    });

    const ordered = this.config.viewId
      ? filtered
      : filtered.sort((left, right) => {
          const priorityDiff = this.priorityScore(right.priority) - this.priorityScore(left.priority);
          if (priorityDiff !== 0) {
            return priorityDiff;
          }

          const leftCreated = new Date(left.created_at ?? 0).getTime();
          const rightCreated = new Date(right.created_at ?? 0).getTime();
          return leftCreated - rightCreated;
        });

    return ordered.map((bug, index) => ({
      ...bug,
      row_index: index + 1
    }));
  }

  normalizeBug(record: FeishuRecord): NormalizedBug {
    const { fieldMapping } = this.config;
    return {
      bug_id: this.getComparableValue(record.fields[fieldMapping.bugId]) || record.record_id,
      row_index: 0,
      title: this.getComparableValue(record.fields[fieldMapping.title]),
      status: this.getComparableValue(record.fields[fieldMapping.status]),
      priority: this.getComparableValue(record.fields[fieldMapping.priority]),
      severity: this.getOptionalMappedValue(record.fields, fieldMapping.severity),
      module: this.getOptionalMappedValue(record.fields, fieldMapping.module),
      repo_hint: this.getOptionalMappedValue(record.fields, fieldMapping.repoHint),
      description: this.getOptionalMappedValue(record.fields, fieldMapping.description),
      repro_steps: this.getOptionalMappedValue(record.fields, fieldMapping.reproSteps),
      expected_result: this.getOptionalMappedValue(record.fields, fieldMapping.expectedResult),
      actual_result: this.getOptionalMappedValue(record.fields, fieldMapping.actualResult),
      assignee: this.getOptionalMappedValue(record.fields, fieldMapping.assignee),
      attachments: this.getAttachmentNames(record.fields, fieldMapping.attachments),
      created_at: this.getOptionalMappedValue(record.fields, fieldMapping.createdAt),
      updated_at: this.getOptionalMappedValue(record.fields, fieldMapping.updatedAt),
      resolved_at: this.getOptionalMappedValue(record.fields, fieldMapping.resolvedAt),
      verification_result: this.getOptionalMappedValue(
        record.fields,
        fieldMapping.verificationResult
      ),
      verification_time: this.getOptionalMappedValue(record.fields, fieldMapping.verificationTime),
      remark:
        this.getOptionalMappedValue(record.fields, fieldMapping.remark) ??
        this.getOptionalMappedValue(record.fields, fieldMapping.comment),
      raw_fields: record.fields
    };
  }

  private getOptionalMappedValue(
    fields: Record<string, unknown>,
    fieldName?: string
  ): string | null {
    if (!fieldName) {
      return null;
    }
    return this.getComparableValue(fields[fieldName]);
  }

  private getAttachmentNames(fields: Record<string, unknown>, fieldName?: string): string[] {
    if (!fieldName) {
      return [];
    }

    const value = fields[fieldName];
    if (!Array.isArray(value)) {
      const text = this.getComparableValue(value);
      return text ? [text] : [];
    }

    return value
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object" && "name" in entry) {
          const name = (entry as { name?: unknown }).name;
          return typeof name === "string" ? name : null;
        }
        return null;
      })
      .filter((name): name is string => Boolean(name));
  }

  private getComparableValue(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      const flattened = value
        .map((item) => this.getComparableValue(item))
        .filter((item): item is string => Boolean(item));
      return flattened.length > 0 ? flattened.join(", ") : null;
    }
    if (typeof value === "object") {
      if ("text" in (value as Record<string, unknown>)) {
        return this.getComparableValue((value as Record<string, unknown>).text);
      }
      if ("name" in (value as Record<string, unknown>)) {
        return this.getComparableValue((value as Record<string, unknown>).name);
      }
      return JSON.stringify(value);
    }
    return null;
  }

  private priorityScore(priority: string | null): number {
    switch ((priority ?? "").trim().toUpperCase()) {
      case "P0":
      case "S0":
      case "CRITICAL":
      case "紧急":
        return 4;
      case "P1":
      case "HIGH":
      case "高":
        return 3;
      case "P2":
      case "MEDIUM":
      case "中":
        return 2;
      case "P3":
      case "LOW":
      case "低":
        return 1;
      default:
        return 0;
    }
  }

  private buildRecordUrl(pageToken?: string): string {
    const url = new URL(this.baseRecordUrl());
    if (this.config.viewId) {
      url.searchParams.set("view_id", this.config.viewId);
    }
    if (pageToken) {
      url.searchParams.set("page_token", pageToken);
    }
    url.searchParams.set("page_size", "500");
    return url.toString();
  }

  private baseRecordUrl(): string {
    return `${this.config.baseUrl}/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records`;
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
      throw new Error(`Feishu API request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  }
}
