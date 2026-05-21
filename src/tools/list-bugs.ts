import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppConfig } from "../config.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import {
  buildErrorResponse,
  buildSuccessResponse,
  classifyReadError,
  toToolPayload
} from "./helpers.js";

export function registerListBugsTool(
  server: McpServer,
  config: AppConfig,
  bitableClient: FeishuBitableClient
): void {
  server.registerTool(
    "list_bugs",
    {
      description: "List bugs from Feishu Bitable. Supports filtering by bug_id, index range, or status/assignee/priority.",
      inputSchema: {
        bug_id: z.string().optional().describe("Specific bug ID to retrieve"),
        start_index: z.number().int().min(1).optional().describe("Start index for range query"),
        end_index: z.number().int().min(1).optional().describe("End index for range query"),
        status: z.string().optional(),
        assignee: z.string().optional(),
        priority: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional()
      }
    },
    async ({ bug_id, start_index: startIndex, end_index: endIndex, status, assignee, priority, limit, offset }) => {
      try {
        const { items } = await bitableClient.listAllRecords();
        const bugs = bitableClient.normalizeAndOrderBugs(items, {
          status,
          assignee,
          priority
        });

        let filteredBugs = bugs;

        if (bug_id) {
          const found = bugs.find(b => b.bug_id === bug_id);
          if (!found) {
            return toToolPayload(
              buildErrorResponse(config, {
                code: "NOT_FOUND",
                message: `Bug ${bug_id} was not found`
              })
            );
          }
          filteredBugs = [found];
        } else if (startIndex !== undefined && endIndex !== undefined) {
          if (startIndex > endIndex) {
            return toToolPayload(
              buildErrorResponse(config, {
                code: "INVALID_RANGE",
                message: "start_index must be less than or equal to end_index"
              })
            );
          }

          if (startIndex > bugs.length || endIndex > bugs.length) {
            return toToolPayload(
              buildErrorResponse(config, {
                code: "INVALID_RANGE",
                message: `Requested range ${startIndex}-${endIndex} is out of bounds for ${bugs.length} bugs`
              })
            );
          }

          filteredBugs = bugs.slice(startIndex - 1, endIndex);
        }

        const safeOffset = offset ?? 0;
        const safeLimit = limit ?? filteredBugs.length;
        const paged = filteredBugs.slice(safeOffset, safeOffset + safeLimit);

        return toToolPayload(
          buildSuccessResponse(config, {
            total: filteredBugs.length,
            items: paged
          })
        );
      } catch (error) {
        return toToolPayload(buildErrorResponse(config, classifyReadError(error)));
      }
    }
  );
}