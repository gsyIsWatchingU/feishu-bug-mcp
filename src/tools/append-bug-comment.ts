import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppConfig } from "../config.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import { buildErrorResponse, buildSuccessResponse, getErrorMessage, toToolPayload } from "./helpers.js";

export function registerAppendBugCommentTool(
  server: McpServer,
  config: AppConfig,
  bitableClient: FeishuBitableClient
): void {
  server.registerTool(
    "append_bug_comment",
    {
      description: "Append a handling comment to a bug. If native comments are unavailable, it writes into the configured remark field.",
      inputSchema: {
        bug_id: z.string().min(1),
        comment: z.string().min(1)
      }
    },
    async ({ bug_id, comment }) => {
      if (!config.fieldMapping.comment) {
        return toToolPayload(
          buildErrorResponse(config, {
            code: "CONFIG_ERROR",
            message: "FEISHU_FIELD_COMMENT is required for append_bug_comment"
          })
        );
      }

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

        const existingValue = record.fields[config.fieldMapping.comment];
        const normalizedExistingValue = typeof existingValue === "string" ? existingValue : "";
        const nextValue = [normalizedExistingValue, comment]
          .filter((item) => item.trim().length > 0)
          .join("\n");

        const updatedRecord = await bitableClient.updateRecord(record.record_id, {
          [config.fieldMapping.comment]: nextValue
        });

        return toToolPayload(buildSuccessResponse(config, bitableClient.normalizeBug(updatedRecord)));
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
