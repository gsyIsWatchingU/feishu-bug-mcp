export type BugStatus =
  | "处理中"
  | "已修复待验证"
  | "无法复现"
  | "需人工确认"
  | "待审查";

export type FeishuFieldMapping = {
  bugId: string;
  title: string;
  status: string;
  priority: string;
  severity?: string;
  module?: string;
  repoHint?: string;
  description?: string;
  reproSteps?: string;
  expectedResult?: string;
  actualResult?: string;
  assignee?: string;
  attachments?: string;
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string;
  verificationResult?: string;
  verificationTime?: string;
  remark?: string;
  comment?: string;
};

export type SourceMetadata = {
  app_token: string;
  table_id: string;
  view_id?: string;
  sort_rule: string;
};

export type ToolErrorCode =
  | "AUTH_ERROR"
  | "NOT_FOUND"
  | "CONFIG_ERROR"
  | "INVALID_RANGE"
  | "VALIDATION_ERROR"
  | "WRITE_ERROR"
  | "UNKNOWN_ERROR";

export type ToolError = {
  code: ToolErrorCode;
  message: string;
  suggestions?: string[];
  details?: string;
  recovery_guide?: string[];
};

export type ToolResponse<T> = {
  ok: boolean;
  data: T | null;
  error?: ToolError;
  source_metadata: SourceMetadata;
};

export type NormalizedBug = {
  bug_id: string;
  row_index: number;
  title: string | null;
  status: string | null;
  priority: string | null;
  severity: string | null;
  module: string | null;
  repo_hint: string | null;
  description: string | null;
  repro_steps: string | null;
  expected_result: string | null;
  actual_result: string | null;
  assignee: string | null;
  attachments: string[];
  created_at: string | null;
  updated_at: string | null;
  resolved_at: string | null;
  verification_result: string | null;
  verification_time: string | null;
  remark: string | null;
  raw_fields: Record<string, unknown>;
};

export type FeishuRecord = {
  record_id: string;
  fields: Record<string, unknown>;
};

export type ListBugFilters = {
  status?: string;
  assignee?: string;
  priority?: string;
};

export type BitableListResult = {
  items: FeishuRecord[];
  total: number;
};
