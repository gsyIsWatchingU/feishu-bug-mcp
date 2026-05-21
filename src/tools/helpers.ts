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
  const enhancedError = enhanceErrorWithSuggestions(error);
  
  return {
    ok: false,
    data,
    error: enhancedError,
    source_metadata: getSourceMetadata(config)
  };
}

function enhanceErrorWithSuggestions(error: ToolError): ToolError {
  const errorEnhancements: Record<string, { suggestions: string[]; recoveryGuide: string[]; details?: string }> = {
    AUTH_ERROR: {
      suggestions: [
        "请检查飞书应用的APP_ID和APP_SECRET是否正确",
        "确认应用已获得正确的权限范围",
        "检查网络连接是否正常"
      ],
      recoveryGuide: [
        "登录飞书开发者后台",
        "进入应用管理页面",
        "确认APP_ID和APP_SECRET无误",
        "检查应用状态是否为已启用",
        "确认权限配置包含多维表格读写权限"
      ],
      details: "飞书API认证失败，可能是凭证错误或权限不足"
    },
    NOT_FOUND: {
      suggestions: [
        "请确认bug_id是否正确",
        "检查bug是否已被删除",
        "尝试使用search_bugs工具搜索相关bug"
      ],
      recoveryGuide: [
        "使用list_bugs工具查看所有bug列表",
        "使用search_bugs工具通过关键词搜索",
        "确认bug_id无误后重试"
      ],
      details: "未找到指定的bug记录"
    },
    CONFIG_ERROR: {
      suggestions: [
        "检查环境变量配置是否完整",
        "确认字段映射配置正确",
        "验证多维表格字段名称是否匹配"
      ],
      recoveryGuide: [
        "查看.env文件配置",
        "确认FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_APP_TOKEN、FEISHU_TABLE_ID已设置",
        "检查字段映射配置是否与多维表格字段名称一致"
      ],
      details: "MCP配置不完整或不正确"
    },
    INVALID_RANGE: {
      suggestions: [
        "确保start_index小于等于end_index",
        "确认请求范围在有效数据范围内",
        "使用list_bugs工具查看总bug数量"
      ],
      recoveryGuide: [
        "调用list_bugs工具获取总bug数量",
        "确保请求范围在1到总数量之间",
        "确保起始索引小于等于结束索引"
      ],
      details: "请求的索引范围无效"
    },
    VALIDATION_ERROR: {
      suggestions: [
        "检查输入参数格式是否正确",
        "确认必填参数已提供",
        "验证参数值是否在允许范围内"
      ],
      recoveryGuide: [
        "查看工具的inputSchema定义",
        "确认所有必填参数已正确提供",
        "确保参数类型和格式符合要求"
      ],
      details: "输入参数验证失败"
    },
    WRITE_ERROR: {
      suggestions: [
        "检查网络连接是否正常",
        "确认用户有修改该bug的权限",
        "验证字段值是否符合多维表格约束"
      ],
      recoveryGuide: [
        "检查网络连接状态",
        "确认飞书应用有写入权限",
        "检查字段值是否符合数据类型要求",
        "查看飞书多维表格的字段约束"
      ],
      details: "写入操作失败，可能是权限问题或数据格式错误"
    },
    UNKNOWN_ERROR: {
      suggestions: [
        "稍后重试操作",
        "检查网络连接",
        "查看相关日志获取更多信息"
      ],
      recoveryGuide: [
        "等待片刻后重试",
        "检查网络连接状态",
        "查看服务器日志获取详细错误信息",
        "如果问题持续存在，请联系管理员"
      ],
      details: "发生未知错误"
    }
  };

  const enhancement = errorEnhancements[error.code];
  if (enhancement) {
    return {
      ...error,
      suggestions: error.suggestions ?? enhancement.suggestions,
      details: error.details ?? enhancement.details,
      recovery_guide: error.recovery_guide ?? enhancement.recoveryGuide
    };
  }
  
  return error;
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
        message: `认证失败: ${error.message}`,
        details: `飞书API返回状态码: ${error.status}, 错误码: ${error.responseCode}`
      };
    }

    if (error.status === 400) {
      return {
        code: "VALIDATION_ERROR",
        message: `请求参数错误: ${error.message}`,
        details: `飞书API返回状态码: ${error.status}, 错误码: ${error.responseCode}`
      };
    }

    if (error.status === 404) {
      return {
        code: "NOT_FOUND",
        message: `资源未找到: ${error.message}`,
        details: `飞书API返回状态码: ${error.status}, 错误码: ${error.responseCode}`
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
        message: `认证失败: ${error.message}`,
        details: `飞书API返回状态码: ${error.status}, 错误码: ${error.responseCode}`
      };
    }

    if (error.status === 400) {
      return {
        code: "VALIDATION_ERROR",
        message: `请求参数错误: ${error.message}`,
        details: `飞书API返回状态码: ${error.status}, 错误码: ${error.responseCode}`
      };
    }

    if (error.status === 404) {
      return {
        code: "NOT_FOUND",
        message: `资源未找到: ${error.message}`,
        details: `飞书API返回状态码: ${error.status}, 错误码: ${error.responseCode}`
      };
    }
  }

  return {
    code: "WRITE_ERROR",
    message: getErrorMessage(error),
    details: error instanceof Error ? error.stack : undefined
  };
}