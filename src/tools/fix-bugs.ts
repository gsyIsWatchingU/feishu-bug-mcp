import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppConfig } from "../config.js";
import { FeishuAiClient } from "../feishu/ai.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import {
  analyzeBugWithContext,
  appendBugRemark,
  buildFailureRemark,
  buildFixRemark,
  resolveTargetBugs,
  resolveWorkspaceDirectories,
  runAgentFix
} from "./analysis-workflow.js";
import {
  buildErrorResponse,
  buildSuccessResponse,
  classifyWriteError,
  toToolPayload
} from "./helpers.js";
import { applyBugWorkflowUpdate } from "./workflow-update.js";

const FIXED_STATUS = "宸蹭慨澶嶅緟楠岃瘉";

type FixBugResult = {
  bug_id: string;
  row_index: number;
  title: string | null;
  success: boolean;
  conclusion?: string;
  evidence_count?: number;
  affected_files?: string[];
  workspace_reads?: {
    workspace: string;
    project_read_path: string;
    reused: boolean;
  }[];
  analysis_remark_updated?: boolean;
  fix_remark_updated?: boolean;
  status_updated?: boolean;
  status_set?: string;
  deprecated_inputs_used?: string[];
  agent_execution?: {
    command: string;
    exit_code: number | null;
    stdout_preview: string;
    stderr_preview: string;
  };
  error?: string;
};

function previewOutput(value: string, maxLength = 600): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

export function registerFixBugsTool(
  server: McpServer,
  config: AppConfig,
  bitableClient: FeishuBitableClient,
  aiClient: FeishuAiClient
): void {
  server.registerTool(
    "fix_bugs",
    {
      description:
        "Analyze selected bugs with multi-workspace context, optionally reuse project-read cache, then ask the current MCP coding agent to apply a fix and sync the workflow back to Feishu.",
      inputSchema: {
        bug_ids: z.array(z.string()).optional().describe("Specific bug IDs to process"),
        start_index: z.number().int().min(1).optional().describe("Start index for range query"),
        end_index: z.number().int().min(1).optional().describe("End index for range query"),
        resolution_summary: z.string().optional().describe("Optional resolution summary appended to fix remarks"),
        workspace_directories: z
          .array(z.string())
          .optional()
          .describe("Absolute workspace directories used for code analysis and fixing"),
        search_directory: z
          .string()
          .optional()
          .describe("Deprecated single workspace directory; kept for backward compatibility"),
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
      resolution_summary,
      workspace_directories,
      search_directory,
      refresh_project_read = false,
      write_analysis_remark = true,
      project_read_filename = "gsy-fix-read.md",
      ai_expand_enabled = true
    }) => {
      try {
        const deprecatedInputsUsed: string[] = [];
        const rawDirectories = workspace_directories ? [...workspace_directories] : [];
        if (search_directory) {
          rawDirectories.push(search_directory);
          deprecatedInputsUsed.push("search_directory");
        }

        const resolvedWorkspaces = resolveWorkspaceDirectories(rawDirectories);
        const targets = await resolveTargetBugs(bitableClient, bug_ids, startIndex, endIndex);
        const results: FixBugResult[] = [];

        for (const { bug, record } of targets) {
          const analysis = await analyzeBugWithContext({
            bug,
            workspaceDirectories: resolvedWorkspaces,
            refreshProjectRead: refresh_project_read,
            projectReadFilename: project_read_filename,
            aiClient,
            aiExpandEnabled: ai_expand_enabled
          });

          let analysisRemarkUpdated = false;
          if (write_analysis_remark) {
            const remarkResult = await appendBugRemark(
              bitableClient,
              config,
              record,
              analysis.analysis_remark
            );
            analysisRemarkUpdated = remarkResult.updated;
          }

          try {
            const execution = await runAgentFix({
              server,
              bug,
              analysis,
              workspaceDirectories: resolvedWorkspaces
            });

            if (execution.exitCode !== 0) {
              const failureRemark = buildFailureRemark(
                `Agent runner exited with code ${execution.exitCode}`,
                execution.stderr
              );
              const failureRemarkResult = await appendBugRemark(
                bitableClient,
                config,
                record,
                failureRemark
              );

              results.push({
                bug_id: bug.bug_id,
                row_index: bug.row_index,
                title: bug.title,
                success: false,
                conclusion: analysis.conclusion,
                evidence_count: analysis.evidence.length,
                affected_files: analysis.suspected_components,
                workspace_reads: analysis.workspace_reads,
                analysis_remark_updated: analysisRemarkUpdated,
                fix_remark_updated: failureRemarkResult.updated,
                status_updated: false,
                deprecated_inputs_used: deprecatedInputsUsed,
                agent_execution: {
                  command: "current_mcp_agent",
                  exit_code: execution.exitCode,
                  stdout_preview: previewOutput(execution.stdout),
                  stderr_preview: previewOutput(execution.stderr)
                },
                error: `Agent runner exited with code ${execution.exitCode}`
              });
              continue;
            }

            const fixRemarkBody = resolution_summary
              ? `${buildFixRemark(execution.stdout, execution.stderr)}\n补充说明：${resolution_summary}`
              : buildFixRemark(execution.stdout, execution.stderr);

            const fixRemarkResult = await appendBugRemark(
              bitableClient,
              config,
              record,
              fixRemarkBody
            );

            await applyBugWorkflowUpdate({
              bitableClient,
              config,
              record,
              status: FIXED_STATUS
            });

            results.push({
              bug_id: bug.bug_id,
              row_index: bug.row_index,
              title: bug.title,
              success: true,
              conclusion: analysis.conclusion,
              evidence_count: analysis.evidence.length,
              affected_files: analysis.suspected_components,
              workspace_reads: analysis.workspace_reads,
              analysis_remark_updated: analysisRemarkUpdated,
              fix_remark_updated: fixRemarkResult.updated,
              status_updated: true,
              status_set: FIXED_STATUS,
              deprecated_inputs_used: deprecatedInputsUsed,
              agent_execution: {
                command: "current_mcp_agent",
                exit_code: execution.exitCode,
                stdout_preview: previewOutput(execution.stdout),
                stderr_preview: previewOutput(execution.stderr)
              }
            });
          } catch (error) {
            const failureMessage = error instanceof Error ? error.message : "Unknown agent runner error";
            const failureRemark = buildFailureRemark(failureMessage, "");
            const failureRemarkResult = await appendBugRemark(
              bitableClient,
              config,
              record,
              failureRemark
            );

            results.push({
              bug_id: bug.bug_id,
              row_index: bug.row_index,
              title: bug.title,
              success: false,
              conclusion: analysis.conclusion,
              evidence_count: analysis.evidence.length,
              affected_files: analysis.suspected_components,
              workspace_reads: analysis.workspace_reads,
              analysis_remark_updated: analysisRemarkUpdated,
              fix_remark_updated: failureRemarkResult.updated,
              status_updated: false,
              deprecated_inputs_used: deprecatedInputsUsed,
              error: failureMessage
            });
          }
        }

        const successCount = results.filter((item) => item.success).length;
        return toToolPayload(
          buildSuccessResponse(config, {
            total: results.length,
            success_count: successCount,
            fail_count: results.length - successCount,
            results
          })
        );
      } catch (error) {
        return toToolPayload(buildErrorResponse(config, classifyWriteError(error)));
      }
    }
  );
}
