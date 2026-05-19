import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppConfig } from "../config.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import { buildErrorResponse, buildSuccessResponse, getErrorMessage, toToolPayload } from "./helpers.js";

export function registerGetBugRangeTool(
  server: McpServer,
  config: AppConfig,
  bitableClient: FeishuBitableClient
): void {
  server.registerTool(
    "get_bug_range",
    {
      description: "Get bugs by stable row index range, used for requests like 第7-10条 bug.",
      inputSchema: {
        start_index: z.number().int().min(1),
        end_index: z.number().int().min(1)
      }
    },
    async ({ start_index: startIndex, end_index: endIndex }) => {

      if (startIndex > endIndex) {
        return toToolPayload(
          buildErrorResponse(config, {
            code: "INVALID_RANGE",
            message: "start_index must be less than or equal to end_index"
          })
        );
      }

      try {
        const { items } = await bitableClient.listAllRecords();
        const bugs = bitableClient.normalizeAndOrderBugs(items);

        if (startIndex > bugs.length || endIndex > bugs.length) {
          return toToolPayload(
            buildErrorResponse(config, {
              code: "INVALID_RANGE",
              message: `Requested range ${startIndex}-${endIndex} is out of bounds for ${bugs.length} bugs`
            })
          );
        }

        return toToolPayload(
          buildSuccessResponse(config, {
            total: bugs.length,
            items: bugs.slice(startIndex - 1, endIndex)
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
