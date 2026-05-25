import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { FeishuAiClient } from "./feishu/ai.js";
import { FeishuAuthClient } from "./feishu/auth.js";
import { FeishuBitableClient } from "./feishu/bitable.js";
import { registerListBugsTool } from "./tools/list-bugs.js";
import { registerAnalyzeBugTool } from "./tools/analyze-bug.js";
import { registerFixBugsTool } from "./tools/fix-bugs.js";
import { registerUpdateBugStatusTool } from "./tools/update-bug-status.js";
import { registerCheckDuplicateBugsTool } from "./tools/check-duplicate-bugs.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const authClient = new FeishuAuthClient(config);
  const bitableClient = new FeishuBitableClient(config, authClient);
  const aiClient = new FeishuAiClient(config, authClient);

  const server = new McpServer({
    name: "feishu-bug-mcp",
    version: "0.1.0"
  });

  registerListBugsTool(server, config, bitableClient);
  registerAnalyzeBugTool(server, config, bitableClient, aiClient);
  registerFixBugsTool(server, config, bitableClient, aiClient);
  registerUpdateBugStatusTool(server, config, bitableClient);
  registerCheckDuplicateBugsTool(server, config, bitableClient);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`[feishu-bug-mcp] ${message}`);
  process.exit(1);
});
