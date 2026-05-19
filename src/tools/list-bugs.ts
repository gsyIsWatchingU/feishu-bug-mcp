import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppConfig } from "../config.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import { buildErrorResponse, buildSuccessResponse, getErrorMessage, toToolPayload } from "./helpers.js";

export function registerListBugsTool(
  server: McpServer,
  config: AppConfig,
  bitableClient: FeishuBitableClient
): void {
  server.registerTool(
    "list_bugs",
    {
      description: "List bugs from Feishu Bitable with stable row_index values.",
      inputSchema: {
        status: z.string().optional(),
        assignee: z.string().optional(),
        priority: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional()
      }
    },
    async ({ status, assignee, priority, limit, offset }) => {
      try {
        const { items } = await bitableClient.listAllRecords();
        const bugs = bitableClient.normalizeAndOrderBugs(items, {
          status,
          assignee,
          priority
        });

        const safeOffset = offset ?? 0;
        const safeLimit = limit ?? bugs.length;
        const paged = bugs.slice(safeOffset, safeOffset + safeLimit);

        return toToolPayload(
          buildSuccessResponse(config, {
            total: bugs.length,
            items: paged
          })
        );
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
