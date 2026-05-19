import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { FeishuAuthClient } from "./feishu/auth.js";
import { FeishuBitableClient } from "./feishu/bitable.js";
import { registerAppendBugCommentTool } from "./tools/append-bug-comment.js";
import { registerGetBugDetailTool } from "./tools/get-bug-detail.js";
import { registerGetBugRangeTool } from "./tools/get-bug-range.js";
import { registerListBugsTool } from "./tools/list-bugs.js";
import { registerUpdateBugStatusTool } from "./tools/update-bug-status.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const authClient = new FeishuAuthClient(config);
  const bitableClient = new FeishuBitableClient(config, authClient);

  const server = new McpServer({
    name: "feishu-bug-mcp",
    version: "0.1.0"
  });

  registerListBugsTool(server, config, bitableClient);
  registerGetBugRangeTool(server, config, bitableClient);
  registerGetBugDetailTool(server, config, bitableClient);
  registerUpdateBugStatusTool(server, config, bitableClient);
  registerAppendBugCommentTool(server, config, bitableClient);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`[feishu-bug-mcp] ${message}`);
  process.exit(1);
});
