import { AppConfig, getSourceMetadata } from "../config.js";
import { FeishuApiError } from "../feishu/api-error.js";
import { ToolError, ToolResponse } from "../types.js";

export function buildSuccessResponse<T>(config: AppConfig, data: T): ToolResponse<T> {
  return {
    ok: true,
    data,
    source_metadata: getSourceMetadata(config)
  };
}

export function buildErrorResponse(
  config: AppConfig,
  error: ToolError,
  data: null = null
): ToolResponse<null> {
  return {
    ok: false,
    data,
    error: enhanceErrorWithSuggestions(error),
    source_metadata: getSourceMetadata(config)
  };
}

export function getRemarkFieldName(config: AppConfig): string | undefined {
  return config.fieldMapping.remark || config.fieldMapping.comment;
}

export function appendRemark(existing: unknown, remark: string): string {
  const normalizedExisting = typeof existing === "string" ? existing.trim() : "";
  if (!normalizedExisting) {
    return remark;
  }

  return `${normalizedExisting}\n\n---\n\n${remark}`;
}

function enhanceErrorWithSuggestions(error: ToolError): ToolError {
  const errorEnhancements: Record<
    string,
    { suggestions: string[]; recoveryGuide: string[]; details?: string }
  > = {
    AUTH_ERROR: {
      suggestions: [
        "确认 FEISHU_APP_ID 和 FEISHU_APP_SECRET 是否正确。",
        "检查当前飞书应用是否仍然可用且具备表格访问权限。",
        "确认租户授权和访问令牌没有过期。"
      ],
      recoveryGuide: [
        "检查 .env 或运行环境中的飞书凭证配置。",
        "在飞书后台确认应用权限和表格权限。",
        "重新启动 MCP 服务后再重试。 "
      ],
      details: "飞书 API 鉴权失败。"
    },
    NOT_FOUND: {
      suggestions: [
        "确认 bug_id 是否正确。",
        "先用 list_bugs 查看当前可访问的 bug 列表。",
        "确认该 bug 没有被删除或移出当前视图。"
      ],
      recoveryGuide: [
        "调用 list_bugs 确认 bug 是否存在。",
        "检查 FEISHU_VIEW_ID 是否筛掉了目标记录。",
        "确认字段映射中的编号列与表格一致。"
      ],
      details: "未找到指定的 bug 记录。"
    },
    CONFIG_ERROR: {
      suggestions: [
        "检查必填环境变量是否完整。",
        "确认字段名称与飞书多维表格中的列名一致。",
        "确认备注字段或评论字段至少配置了一个。"
      ],
      recoveryGuide: [
        "核对 .env 中的 FEISHU_* 配置。",
        "确认 FEISHU_FIELD_STATUS、FEISHU_FIELD_REMARK、FEISHU_FIELD_COMMENT 等字段映射。",
        "保存配置后重启 MCP 服务。"
      ],
      details: "MCP 配置不完整或与表格结构不匹配。"
    },
    INVALID_RANGE: {
      suggestions: [
        "确认 start_index 小于或等于 end_index。",
        "先用 list_bugs 查看当前 bug 总数。",
        "不要传入超出当前列表范围的索引。"
      ],
      recoveryGuide: [
        "先调用 list_bugs 获取总数。",
        "调整 start_index 和 end_index 后重试。"
      ],
      details: "请求的 bug 索引范围无效。"
    },
    VALIDATION_ERROR: {
      suggestions: [
        "检查入参是否完整。",
        "确认状态值是否在允许范围内。",
        "确认闭环所需的备注信息是否完整。"
      ],
      recoveryGuide: [
        "对照工具的 inputSchema 检查参数。",
        "补齐缺失字段后重新调用工具。"
      ],
      details: "参数校验失败。"
    },
    WRITE_ERROR: {
      suggestions: [
        "确认当前飞书应用具有写入权限。",
        "确认目标字段没有被删除、锁定或改名。",
        "检查网络和飞书 API 服务状态。"
      ],
      recoveryGuide: [
        "先用 list_bugs 验证读权限是否正常。",
        "确认状态列和备注列都允许写入。",
        "排除权限或网络问题后再重试。"
      ],
      details: "写入飞书多维表格失败。"
    },
    UNKNOWN_ERROR: {
      suggestions: [
        "查看错误栈定位具体失败点。",
        "先确认配置、权限和网络都正常。",
        "缩小调用范围后再次复现。"
      ],
      recoveryGuide: [
        "记录当前入参与错误信息。",
        "重新启动服务后重试。",
        "如问题持续，结合日志进一步排查。"
      ],
      details: "发生了未归类的异常。"
    }
  };

  const enhancement = errorEnhancements[error.code];
  if (!enhancement) {
    return error;
  }

  return {
    ...error,
    suggestions: error.suggestions ?? enhancement.suggestions,
    details: error.details ?? enhancement.details,
    recovery_guide: error.recovery_guide ?? enhancement.recoveryGuide
  };
}

export function toToolPayload<T>(result: ToolResponse<T>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2)
      }
    ],
    structuredContent: result
  };
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function classifyReadError(error: unknown): ToolError {
  if (error instanceof FeishuApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        code: "AUTH_ERROR",
        message: `飞书鉴权失败：${error.message}`,
        details: `飞书 API 状态码：${error.status}，错误码：${error.responseCode}`
      };
    }

    if (error.status === 400) {
      return {
        code: "VALIDATION_ERROR",
        message: `请求参数无效：${error.message}`,
        details: `飞书 API 状态码：${error.status}，错误码：${error.responseCode}`
      };
    }

    if (error.status === 404) {
      return {
        code: "NOT_FOUND",
        message: `目标资源不存在：${error.message}`,
        details: `飞书 API 状态码：${error.status}，错误码：${error.responseCode}`
      };
    }
  }

  return {
    code: "UNKNOWN_ERROR",
    message: getErrorMessage(error),
    details: error instanceof Error ? error.stack : undefined
  };
}

export function classifyWriteError(error: unknown): ToolError {
  if (error instanceof FeishuApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        code: "AUTH_ERROR",
        message: `飞书鉴权失败：${error.message}`,
        details: `飞书 API 状态码：${error.status}，错误码：${error.responseCode}`
      };
    }

    if (error.status === 400) {
      return {
        code: "VALIDATION_ERROR",
        message: `请求参数无效：${error.message}`,
        details: `飞书 API 状态码：${error.status}，错误码：${error.responseCode}`
      };
    }

    if (error.status === 404) {
      return {
        code: "NOT_FOUND",
        message: `目标资源不存在：${error.message}`,
        details: `飞书 API 状态码：${error.status}，错误码：${error.responseCode}`
      };
    }
  }

  return {
    code: "WRITE_ERROR",
    message: getErrorMessage(error),
    details: error instanceof Error ? error.stack : undefined
  };
}
