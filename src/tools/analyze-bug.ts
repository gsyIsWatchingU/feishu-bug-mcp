import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppConfig } from "../config.js";
import { FeishuAiClient } from "../feishu/ai.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import {
  analyzeBugWithContext,
  appendBugRemark,
  resolveTargetBugs,
  resolveWorkspaceDirectories
} from "./analysis-workflow.js";
import {
  buildErrorResponse,
  buildSuccessResponse,
  classifyWriteError,
  toToolPayload
} from "./helpers.js";

type AnalyzeBugResult = {
  bug_id: string;
  row_index: number;
  title: string | null;
  conclusion: string;
  evidence: {
    workspace: string;
    file: string;
    reason: string;
    matched_symbols: string[];
  }[];
  suspected_components: string[];
  workspace_reads: {
    workspace: string;
    project_read_path: string;
    reused: boolean;
  }[];
  remark_updated: boolean;
  next_step: string;
};

export function registerAnalyzeBugTool(
  server: McpServer,
  config: AppConfig,
  bitableClient: FeishuBitableClient,
  aiClient: FeishuAiClient
): void {
  server.registerTool(
    "analyze_bug",
    {
      description:
        "Analyze selected bugs across one or more absolute workspace directories, reuse or regenerate gsy-fix-read.md, return structured evidence, and optionally sync the analysis back to Feishu remarks.",
      inputSchema: {
        bug_ids: z.array(z.string()).optional().describe("Specific bug IDs to analyze"),
        start_index: z.number().int().min(1).optional().describe("Start index for range query"),
        end_index: z.number().int().min(1).optional().describe("End index for range query"),
        workspace_directories: z
          .array(z.string())
          .optional()
          .describe("Absolute workspace directories used for analysis"),
        refresh_project_read: z
          .boolean()
          .optional()
          .default(false)
          .describe("Force rebuild gsy-fix-read.md in each workspace"),
        write_analysis_remark: z
          .boolean()
          .optional()
          .default(true)
          .describe("Whether to append the analysis result to the Feishu remark field"),
        project_read_filename: z
          .string()
          .optional()
          .default("gsy-fix-read.md")
          .describe("Filename used for per-workspace project-read cache"),
        ai_expand_enabled: z
          .boolean()
          .optional()
          .default(true)
          .describe("Whether to expand bug description through Feishu AI before analysis")
      }
    },
    async ({
      bug_ids,
      start_index: startIndex,
      end_index: endIndex,
      workspace_directories,
      refresh_project_read = false,
      write_analysis_remark = true,
      project_read_filename = "gsy-fix-read.md",
      ai_expand_enabled = true
    }) => {
      try {
        const resolvedWorkspaces = resolveWorkspaceDirectories(workspace_directories);
        const targets = await resolveTargetBugs(bitableClient, bug_ids, startIndex, endIndex);
        const results: AnalyzeBugResult[] = [];

        for (const { bug, record } of targets) {
          const analysis = await analyzeBugWithContext({
            bug,
            workspaceDirectories: resolvedWorkspaces,
            refreshProjectRead: refresh_project_read,
            projectReadFilename: project_read_filename,
            aiClient,
            aiExpandEnabled: ai_expand_enabled
          });

          let remarkUpdated = false;
          if (write_analysis_remark) {
            const remarkResult = await appendBugRemark(
              bitableClient,
              config,
              record,
              analysis.analysis_remark
            );
            remarkUpdated = remarkResult.updated;
          }

          results.push({
            bug_id: bug.bug_id,
            row_index: bug.row_index,
            title: bug.title,
            conclusion: analysis.conclusion,
            evidence: analysis.evidence,
            suspected_components: analysis.suspected_components,
            workspace_reads: analysis.workspace_reads,
            remark_updated: remarkUpdated,
            next_step: analysis.next_step
          });
        }

        return toToolPayload(
          buildSuccessResponse(config, {
            total: results.length,
            results
          })
        );
      } catch (error) {
        return toToolPayload(buildErrorResponse(config, classifyWriteError(error)));
      }
    }
  );
}
