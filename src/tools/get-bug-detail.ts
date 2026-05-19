import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppConfig } from "../config.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import { buildErrorResponse, buildSuccessResponse, getErrorMessage, toToolPayload } from "./helpers.js";

export function registerGetBugDetailTool(
  server: McpServer,
  config: AppConfig,
  bitableClient: FeishuBitableClient
): void {
  server.registerTool(
    "get_bug_detail",
    {
      description: "Get full normalized detail for one bug by bug_id.",
      inputSchema: {
        bug_id: z.string().min(1)
      }
    },
    async ({ bug_id }) => {
      try {
        const { items } = await bitableClient.listAllRecords();
        const ordered = bitableClient.normalizeAndOrderBugs(items);
        const foundBug = ordered.find((bug) => bug.bug_id === bug_id);

        if (!foundBug) {
          return toToolPayload(
            buildErrorResponse(config, {
              code: "NOT_FOUND",
              message: `Bug ${bug_id} was not found`
            })
          );
        }

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
        bug.row_index = foundBug.row_index;

        return toToolPayload(buildSuccessResponse(config, bug));
      } catch (error) {
        return toToolPayload(
          buildErrorResponse(config, {
            code: "AUTH_ERROR",
            message: getErrorMessage(error)
          })
        );
      }
    }
  );
}
