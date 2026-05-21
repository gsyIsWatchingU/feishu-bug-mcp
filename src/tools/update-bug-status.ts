import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppConfig } from "../config.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import {
  buildErrorResponse,
  buildSuccessResponse,
  classifyWriteError,
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
      description: "Update bug status or verify if a bug is fixed. Supports validation confirmation and adding verification results.",
      inputSchema: {
        bug_id: z.string().min(1).describe("Bug ID to update"),
        status: z.enum(ALLOWED_BUG_STATUS).optional().describe("New status for the bug"),
        verify_fixed: z.boolean().optional().describe("Set to true to verify and mark bug as resolved after verification"),
        verification_result: z.string().optional().describe("Verification result/notes"),
        resolution_summary: z.string().optional().describe("Summary of the resolution")
      }
    },
    async ({ bug_id, status, verify_fixed, verification_result, resolution_summary }) => {
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

        const bug = bitableClient.normalizeBug(record);
        const fieldsToUpdate: Record<string, unknown> = {};

        if (verify_fixed) {
          const currentStatus = bug.status;
          if (currentStatus !== "\u5df2\u4fee\u590d\u5f85\u9a8c\u8bc1") {
            return toToolPayload(
              buildErrorResponse(config, {
                code: "VALIDATION_ERROR",
                message: `Cannot verify bug - current status is "${currentStatus}", expected "已修复待验证"`
              })
            );
          }

          fieldsToUpdate[config.fieldMapping.status] = "\u9700\u4eba\u5de5\u786e\u8ba4";
          
          if (config.fieldMapping.verificationResult && verification_result) {
            fieldsToUpdate[config.fieldMapping.verificationResult] = verification_result;
          }
          
          if (config.fieldMapping.verificationTime) {
            fieldsToUpdate[config.fieldMapping.verificationTime] = new Date().toISOString();
          }
        } else if (status) {
          fieldsToUpdate[config.fieldMapping.status] = status;
        }

        if (typeof resolution_summary === "string" && config.fieldMapping.comment) {
          const existingComment = record.fields[config.fieldMapping.comment];
          const normalizedExisting = typeof existingComment === "string" ? existingComment : "";
          fieldsToUpdate[config.fieldMapping.comment] = [normalizedExisting, resolution_summary]
            .filter(Boolean)
            .join("\n");
        }

        if (Object.keys(fieldsToUpdate).length === 0) {
          return toToolPayload(
            buildErrorResponse(config, {
              code: "VALIDATION_ERROR",
              message: "No valid update parameters provided. Specify status, verify_fixed, or resolution_summary"
            })
          );
        }

        const updatedRecord = await bitableClient.updateRecord(record.record_id, fieldsToUpdate);
        return toToolPayload(
          buildSuccessResponse(config, {
            bug: bitableClient.normalizeBug(updatedRecord),
            updated_fields: Object.keys(fieldsToUpdate)
          })
        );
      } catch (error) {
        return toToolPayload(buildErrorResponse(config, classifyWriteError(error)));
      }
    }
  );
}