import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FeishuFieldMapping, SourceMetadata } from "./types.js";

const BUG_STATUS_VALUES = [
  "\u5904\u7406\u4e2d",
  "\u5df2\u4fee\u590d\u5f85\u9a8c\u8bc1",
  "\u65e0\u6cd5\u590d\u73b0",
  "\u9700\u4eba\u5de5\u786e\u8ba4"
] as const;

type EnvConfig = {
  appId: string;
  appSecret: string;
  appToken: string;
  tableId: string;
  viewId?: string;
  baseUrl: string;
  fieldMapping: FeishuFieldMapping;
  statusWhitelist: string[];
};

const REQUIRED_ENV_VARS = [
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_APP_TOKEN",
  "FEISHU_TABLE_ID",
  "FEISHU_FIELD_ID",
  "FEISHU_FIELD_TITLE",
  "FEISHU_FIELD_STATUS",
  "FEISHU_FIELD_PRIORITY"
] as const;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function loadDotEnvFile(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function loadConfig(): EnvConfig {
  loadDotEnvFile();

  for (const envName of REQUIRED_ENV_VARS) {
    requireEnv(envName);
  }

  return {
    appId: requireEnv("FEISHU_APP_ID"),
    appSecret: requireEnv("FEISHU_APP_SECRET"),
    appToken: requireEnv("FEISHU_APP_TOKEN"),
    tableId: requireEnv("FEISHU_TABLE_ID"),
    viewId: optionalEnv("FEISHU_VIEW_ID"),
    baseUrl: optionalEnv("FEISHU_BASE_URL") ?? "https://open.feishu.cn/open-apis",
    fieldMapping: {
      bugId: requireEnv("FEISHU_FIELD_ID"),
      title: requireEnv("FEISHU_FIELD_TITLE"),
      status: requireEnv("FEISHU_FIELD_STATUS"),
      priority: requireEnv("FEISHU_FIELD_PRIORITY"),
      severity: optionalEnv("FEISHU_FIELD_SEVERITY"),
      module: optionalEnv("FEISHU_FIELD_MODULE"),
      repoHint: optionalEnv("FEISHU_FIELD_REPO_HINT"),
      description: optionalEnv("FEISHU_FIELD_DESCRIPTION"),
      reproSteps: optionalEnv("FEISHU_FIELD_REPRO_STEPS"),
      expectedResult: optionalEnv("FEISHU_FIELD_EXPECTED_RESULT"),
      actualResult: optionalEnv("FEISHU_FIELD_ACTUAL_RESULT"),
      assignee: optionalEnv("FEISHU_FIELD_ASSIGNEE"),
      attachments: optionalEnv("FEISHU_FIELD_ATTACHMENTS"),
      createdAt: optionalEnv("FEISHU_FIELD_CREATED_AT"),
      updatedAt: optionalEnv("FEISHU_FIELD_UPDATED_AT"),
      comment: optionalEnv("FEISHU_FIELD_COMMENT")
    },
    statusWhitelist: [...BUG_STATUS_VALUES]
  };
}

export function getSourceMetadata(config: EnvConfig): SourceMetadata {
  return {
    app_token: config.appToken,
    table_id: config.tableId,
    view_id: config.viewId,
    sort_rule: config.viewId
      ? "view_order"
      : "priority_desc_then_created_at_asc"
  };
}

export type AppConfig = EnvConfig;
