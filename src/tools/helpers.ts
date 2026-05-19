import { AppConfig, getSourceMetadata } from "../config.js";
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
    error,
    source_metadata: getSourceMetadata(config)
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
