import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUG_STATUS_VALUES, FeishuFieldMapping, SourceMetadata } from "./types.js";

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
  "FEISHU_TABLE_ID"
] as const;

const DEFAULT_FIELD_NAMES = {
  bugId: "编号",
  title: "Bug标题/描述",
  status: "解决状态",
  priority: "优先级",
  module: "所属模块",
  createdAt: "创建时间",
  resolvedAt: "解决时间",
  verificationResult: "验证结果",
  verificationTime: "验证时间",
  comment: "备注",
  remark: "备注"
} as const;

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

function envOrDefault(name: string, fallback: string): string {
  return optionalEnv(name) ?? fallback;
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
      bugId: envOrDefault("FEISHU_FIELD_ID", DEFAULT_FIELD_NAMES.bugId),
      title: envOrDefault("FEISHU_FIELD_TITLE", DEFAULT_FIELD_NAMES.title),
      status: envOrDefault("FEISHU_FIELD_STATUS", DEFAULT_FIELD_NAMES.status),
      priority: envOrDefault("FEISHU_FIELD_PRIORITY", DEFAULT_FIELD_NAMES.priority),
      severity: optionalEnv("FEISHU_FIELD_SEVERITY"),
      module: optionalEnv("FEISHU_FIELD_MODULE") ?? DEFAULT_FIELD_NAMES.module,
      repoHint: optionalEnv("FEISHU_FIELD_REPO_HINT"),
      description: optionalEnv("FEISHU_FIELD_DESCRIPTION"),
      reproSteps: optionalEnv("FEISHU_FIELD_REPRO_STEPS"),
      expectedResult: optionalEnv("FEISHU_FIELD_EXPECTED_RESULT"),
      actualResult: optionalEnv("FEISHU_FIELD_ACTUAL_RESULT"),
      assignee: optionalEnv("FEISHU_FIELD_ASSIGNEE"),
      attachments: optionalEnv("FEISHU_FIELD_ATTACHMENTS"),
      createdAt: optionalEnv("FEISHU_FIELD_CREATED_AT") ?? DEFAULT_FIELD_NAMES.createdAt,
      updatedAt: optionalEnv("FEISHU_FIELD_UPDATED_AT"),
      resolvedAt: optionalEnv("FEISHU_FIELD_RESOLVED_AT") ?? DEFAULT_FIELD_NAMES.resolvedAt,
      verificationResult:
        optionalEnv("FEISHU_FIELD_VERIFICATION_RESULT") ?? DEFAULT_FIELD_NAMES.verificationResult,
      verificationTime:
        optionalEnv("FEISHU_FIELD_VERIFICATION_TIME") ?? DEFAULT_FIELD_NAMES.verificationTime,
      remark: optionalEnv("FEISHU_FIELD_REMARK") ?? DEFAULT_FIELD_NAMES.remark,
      comment: optionalEnv("FEISHU_FIELD_COMMENT") ?? DEFAULT_FIELD_NAMES.comment
    },
    statusWhitelist: [...BUG_STATUS_VALUES]
  };
}

export function getSourceMetadata(config: EnvConfig): SourceMetadata {
  return {
    app_token: config.appToken,
    table_id: config.tableId,
    view_id: config.viewId,
    sort_rule: config.viewId ? "view_order" : "priority_desc_then_created_at_asc"
  };
}

export type AppConfig = EnvConfig;
