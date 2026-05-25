import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppConfig } from "../config.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import { BUG_STATUS_VALUES } from "../types.js";
import {
  buildErrorResponse,
  buildSuccessResponse,
  classifyWriteError,
  toToolPayload
} from "./helpers.js";
import { applyBugWorkflowUpdate } from "./workflow-update.js";

const FIXED_WAITING_VERIFICATION_STATUS = BUG_STATUS_VALUES[1];
const MANUAL_CONFIRM_STATUS = BUG_STATUS_VALUES[3];

export function registerUpdateBugStatusTool(
  server: McpServer,
  config: AppConfig,
  bitableClient: FeishuBitableClient
): void {
  server.registerTool(
    "update_bug_status",
    {
      description: "Update bug status or append verification / resolution details back to Feishu.",
      inputSchema: {
        bug_id: z.string().min(1).describe("Bug ID to update"),
        status: z.enum(BUG_STATUS_VALUES).optional().describe("Target bug status"),
        verify_fixed: z.boolean().optional().describe("Whether to run the verification status transition"),
        verification_result: z.string().optional().describe("Verification summary or notes"),
        resolution_summary: z.string().optional().describe("Resolution summary appended to remark/comment")
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
        if (verify_fixed && bug.status !== FIXED_WAITING_VERIFICATION_STATUS) {
          return toToolPayload(
            buildErrorResponse(config, {
              code: "VALIDATION_ERROR",
              message: `Cannot verify bug - current status is "${bug.status}", expected "${FIXED_WAITING_VERIFICATION_STATUS}"`
            })
          );
        }

        if (!verify_fixed && !status && typeof resolution_summary !== "string") {
          return toToolPayload(
            buildErrorResponse(config, {
              code: "VALIDATION_ERROR",
              message: "No valid update parameters provided. Specify status, verify_fixed, or resolution_summary"
            })
          );
        }

        const workflowResult = await applyBugWorkflowUpdate({
          bitableClient,
          config,
          record,
          status: verify_fixed ? MANUAL_CONFIRM_STATUS : status,
          verification_result: verify_fixed ? verification_result : undefined,
          verification_time: verify_fixed ? new Date().toISOString() : undefined,
          resolution_summary
        });

        return toToolPayload(
          buildSuccessResponse(config, {
            bug: bitableClient.normalizeBug(workflowResult.updatedRecord),
            updated_fields: workflowResult.updatedFields
          })
        );
      } catch (error) {
        const writeError = classifyWriteError(error);
        if (
          error instanceof Error &&
          error.message === "No remark/comment field configured for resolution summary"
        ) {
          writeError.code = "CONFIG_ERROR";
          writeError.message = error.message;
        }

        return toToolPayload(buildErrorResponse(config, writeError));
      }
    }
  );
}
