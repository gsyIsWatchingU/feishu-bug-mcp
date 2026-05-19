import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppConfig } from "../config.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import {
  buildErrorResponse,
  buildSuccessResponse,
  getErrorMessage,
  toToolPayload
} from "./helpers.js";

const ALLOWED_BUG_STATUS = [
  "\u5904\u7406\u4e2d",
  "\u5df2\u4fee\u590d\u5f85\u9a8c\u8bc1",
  "\u65e0\u6cd5\u590d\u73b0",
  "\u9700\u4eba\u5de5\u786e\u8ba4"
] as const;

export function registerUpdateBugStatusTool(
  server: McpServer,
  config: AppConfig,
  bitableClient: FeishuBitableClient
): void {
  server.registerTool(
    "update_bug_status",
    {
      description: "Update bug status to one of the allowed values and optionally append a resolution summary.",
      inputSchema: {
        bug_id: z.string().min(1),
        status: z.enum(ALLOWED_BUG_STATUS),
        resolution_summary: z.string().optional()
      }
    },
    async ({ bug_id, status, resolution_summary }) => {
      try {
        const record = await bitableClient.getRecordByBugId(bug_id);
        if (!record) {
          return toToolPayload(
            buildErrorResponse(config, {
              code: "NOT_FOUND",
              message: `Bug ${bug_id} was not found`
            })
          );
        }

        const fieldsToUpdate: Record<string, unknown> = {
          [config.fieldMapping.status]: status
        };

        if (typeof resolution_summary === "string" && config.fieldMapping.comment) {
          fieldsToUpdate[config.fieldMapping.comment] = resolution_summary;
        }

        const updatedRecord = await bitableClient.updateRecord(record.record_id, fieldsToUpdate);
        return toToolPayload(
          buildSuccessResponse(config, bitableClient.normalizeBug(updatedRecord))
        );
      } catch (error) {
        return toToolPayload(
          buildErrorResponse(config, {
            code: "WRITE_ERROR",
            message: getErrorMessage(error)
          })
        );
      }
    }
  );
}
