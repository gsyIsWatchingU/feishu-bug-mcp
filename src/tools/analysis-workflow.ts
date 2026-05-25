import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppConfig } from "../config.js";
import { FeishuAiClient } from "../feishu/ai.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import { FeishuRecord, NormalizedBug } from "../types.js";
import { applyBugWorkflowUpdate } from "./workflow-update.js";

export type WorkspaceReadResult = {
  workspace: string;
  project_read_path: string;
  reused: boolean;
};

export type AnalysisEvidence = {
  workspace: string;
  file: string;
  reason: string;
  matched_symbols: string[];
};

export type BugAnalysisResult = {
  conclusion: string;
  evidence: AnalysisEvidence[];
  suspected_components: string[];
  next_step: string;
  workspace_reads: WorkspaceReadResult[];
  project_read_paths: string[];
  search_keywords: string[];
  analysis_remark: string;
};

export type BugTarget = {
  bug: NormalizedBug;
  record: FeishuRecord;
};

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".vue",
  ".svelte",
  ".py",
  ".go",
  ".java",
  ".xml",
  ".sql",
  ".json",
  ".yml",
  ".yaml",
  ".md"
]);

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".idea",
  ".vscode",
  "target",
  "out"
]);

function walkFiles(rootDir: string, limit = 400): string[] {
  const files: string[] = [];
  const queue = [rootDir];

  while (queue.length > 0 && files.length < limit) {
    const current = queue.shift()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env") {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          queue.push(fullPath);
        }
        continue;
      }

      if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
        if (files.length >= limit) {
          break;
        }
      }
    }
  }

  return files;
}

function truncateText(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

export function extractKeywords(bug: NormalizedBug): string[] {
  const textFields = [
    bug.title,
    bug.description,
    bug.repro_steps,
    bug.expected_result,
    bug.actual_result,
    bug.module,
    bug.repo_hint
  ].filter(Boolean) as string[];

  const allText = textFields.join(" ");
  const keywords: string[] = [];

  const asciiPattern = /[a-zA-Z_][a-zA-Z0-9_]{2,}/g;
  let match: RegExpExecArray | null;
  while ((match = asciiPattern.exec(allText)) !== null) {
    keywords.push(match[0]);
  }

  const chinesePattern = /[\u4e00-\u9fa5]{2,}/g;
  while ((match = chinesePattern.exec(allText)) !== null) {
    keywords.push(match[0]);
  }

  return [...new Set(keywords)].slice(0, 20);
}

function detectTechStack(workspaceDir: string): string[] {
  const stack: string[] = [];
  if (fs.existsSync(path.join(workspaceDir, "package.json"))) {
    stack.push("Node.js");
  }
  if (fs.existsSync(path.join(workspaceDir, "tsconfig.json"))) {
    stack.push("TypeScript");
  }
  if (fs.existsSync(path.join(workspaceDir, "pom.xml"))) {
    stack.push("Java / Maven");
  }
  if (fs.existsSync(path.join(workspaceDir, "build.gradle")) || fs.existsSync(path.join(workspaceDir, "build.gradle.kts"))) {
    stack.push("Java / Gradle");
  }
  if (fs.existsSync(path.join(workspaceDir, "requirements.txt")) || fs.existsSync(path.join(workspaceDir, "pyproject.toml"))) {
    stack.push("Python");
  }
  return stack;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function findInterestingFiles(workspaceDir: string, keywords: string[], repoHint?: string | null): string[] {
  const allFiles = walkFiles(workspaceDir, 500);
  const loweredHint = repoHint?.toLowerCase().trim();

  return allFiles.filter((filePath) => {
    const relativePath = path.relative(workspaceDir, filePath).replace(/\\/g, "/");
    const loweredPath = relativePath.toLowerCase();

    if (loweredHint && loweredPath.includes(loweredHint)) {
      return true;
    }

    return keywords.some((keyword) => loweredPath.includes(keyword.toLowerCase()));
  });
}

function searchEvidence(workspaces: string[], keywords: string[], repoHint?: string | null): AnalysisEvidence[] {
  const evidence: AnalysisEvidence[] = [];

  for (const workspace of workspaces) {
    const candidateFiles = findInterestingFiles(workspace, keywords, repoHint);
    for (const filePath of candidateFiles) {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const matchedSymbols = keywords.filter((keyword) =>
          content.toLowerCase().includes(keyword.toLowerCase())
        );

        if (matchedSymbols.length === 0) {
          continue;
        }

        const relativePath = path.relative(workspace, filePath).replace(/\\/g, "/");
        let reason = `文件内容命中关键词：${matchedSymbols.slice(0, 5).join("、")}`;

        if (/value\s*:|mock|hardcode|hard-code|写死/i.test(content)) {
          reason += "；内容中出现疑似硬编码/Mock 迹象";
        } else if (/controller|service|mapper|api|request|fetch|axios/i.test(relativePath)) {
          reason += "；路径看起来属于接口或服务实现";
        } else if (/page|view|component|screen/i.test(relativePath)) {
          reason += "；路径看起来属于页面或组件实现";
        }

        evidence.push({
          workspace,
          file: filePath,
          reason,
          matched_symbols: matchedSymbols.slice(0, 8)
        });

        if (evidence.length >= 12) {
          return evidence;
        }
      } catch {
        continue;
      }
    }
  }

  return evidence;
}

function buildProjectReadDocument(
  workspaceDir: string,
  projectReadPath: string,
  keywords: string[]
): void {
  const readmePath = ["README.md", "readme.md"].map((name) => path.join(workspaceDir, name)).find(fs.existsSync);
  const readmePreview = readmePath
    ? truncateText(fs.readFileSync(readmePath, "utf8"), 500)
    : "未找到 README，项目说明需要从目录和配置推断。";

  const packageJson = readJsonFile<{
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(path.join(workspaceDir, "package.json"));

  const topEntries = (() => {
    try {
      return fs
        .readdirSync(workspaceDir, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith("."))
        .slice(0, 20);
    } catch {
      return [];
    }
  })();

  const topDirectories = topEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const topFiles = topEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const interestingFiles = walkFiles(workspaceDir, 120).filter((filePath) => {
    const lowered = path.basename(filePath).toLowerCase();
    return /readme|package|tsconfig|main|index|app|router|route|controller|service|api|mapper/.test(lowered);
  });

  const keyFiles = interestingFiles
    .slice(0, 15)
    .map((filePath) => `- ${path.relative(workspaceDir, filePath).replace(/\\/g, "/")}`)
    .join("\n");

  const scripts = packageJson?.scripts
    ? Object.entries(packageJson.scripts)
        .slice(0, 10)
        .map(([name, command]) => `- ${name}: ${command}`)
        .join("\n")
    : "- 未识别 package.json scripts";

  const dependencies = [
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {})
  ]
    .slice(0, 20)
    .join(", ");

  const content = [
    "# gsy-fix-read",
    "",
    "## 项目简介",
    `- 工作目录：${workspaceDir}`,
    `- 项目名称：${packageJson?.name ?? path.basename(workspaceDir)}`,
    `- README 摘要：${readmePreview}`,
    "",
    "## 技术栈与启动/构建命令",
    `- 技术栈：${detectTechStack(workspaceDir).join(" / ") || "待补充"}`,
    scripts,
    dependencies ? `- 主要依赖：${dependencies}` : "- 主要依赖：未识别",
    "",
    "## 目录职责",
    `- 顶层目录：${topDirectories.join("、") || "未识别"}`,
    `- 顶层文件：${topFiles.join("、") || "未识别"}`,
    "",
    "## 关键入口与路由/API",
    keyFiles || "- 未识别明显入口文件",
    "",
    "## 业务模块映射",
    `- 可优先关注与这些关键词相关的模块：${keywords.join("、") || "暂无关键词"}`,
    "",
    "## 搜索关键词与高频文件",
    `- 搜索关键词：${keywords.join("、") || "暂无关键词"}`,
    keyFiles || "- 未识别高频文件",
    "",
    "## Bug 排查建议",
    "- 先核对页面/入口是否接入真实接口或服务。",
    "- 再核对服务层、控制器、SQL/Mapper 是否存在对应能力。",
    "- 如果前后端分离，优先检查调用链是否在前端页面层断开。"
  ].join("\n");

  fs.writeFileSync(projectReadPath, content, "utf8");
}

export function resolveWorkspaceDirectories(workspaceDirectories?: string[]): string[] {
  const trimmed = (workspaceDirectories ?? []).map((dir) => dir.trim()).filter(Boolean);
  for (const directory of trimmed) {
    if (!path.isAbsolute(directory)) {
      throw new Error(
        `Workspace directory must be an absolute path: ${directory}. Please pass workspace_directories like ["E:/project/web", "E:/project/server"].`
      );
    }
  }

  const normalized = trimmed.map((dir) => path.resolve(dir));

  const unique = [...new Set(normalized.length > 0 ? normalized : [process.cwd()])];
  if (unique.length === 0) {
    throw new Error(
      "Missing workspace directories. Please provide workspace_directories as an array of absolute paths."
    );
  }

  for (const directory of unique) {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      throw new Error(
        `Workspace directory does not exist or is not a directory: ${directory}. Please pass a valid absolute project path in workspace_directories.`
      );
    }
  }

  return unique;
}

export async function resolveTargetBugs(
  bitableClient: FeishuBitableClient,
  bugIds?: string[],
  startIndex?: number,
  endIndex?: number
): Promise<BugTarget[]> {
  if (!bugIds && (!startIndex || !endIndex)) {
    throw new Error("Either bug_ids array or start_index/end_index range must be provided");
  }

  if (startIndex !== undefined && endIndex !== undefined && startIndex > endIndex) {
    throw new Error("start_index must be less than or equal to end_index");
  }

  const { items } = await bitableClient.listAllRecords();
  const bugs = bitableClient.normalizeAndOrderBugs(items);
  const recordMap = new Map<string, FeishuRecord>();

  items.forEach((record) => {
    const bug = bitableClient.normalizeBug(record);
    recordMap.set(bug.bug_id, record);
  });

  let targetBugs: NormalizedBug[] = [];
  if (bugIds && bugIds.length > 0) {
    const notFoundIds: string[] = [];
    for (const bugId of bugIds) {
      const found = bugs.find((item) => item.bug_id === bugId);
      if (found) {
        targetBugs.push(found);
      } else {
        notFoundIds.push(bugId);
      }
    }

    if (notFoundIds.length > 0) {
      throw new Error(`Bugs not found: ${notFoundIds.join(", ")}`);
    }
  } else if (startIndex !== undefined && endIndex !== undefined) {
    if (startIndex > bugs.length || endIndex > bugs.length) {
      throw new Error(`Requested range ${startIndex}-${endIndex} is out of bounds for ${bugs.length} bugs`);
    }
    targetBugs = bugs.slice(startIndex - 1, endIndex);
  }

  return targetBugs.map((bug) => {
    const record = recordMap.get(bug.bug_id);
    if (!record) {
      throw new Error(`Record not found for bug ${bug.bug_id}`);
    }

    return { bug, record };
  });
}

export async function analyzeBugWithContext(options: {
  bug: NormalizedBug;
  workspaceDirectories: string[];
  refreshProjectRead?: boolean;
  projectReadFilename?: string;
  aiClient?: FeishuAiClient;
  aiExpandEnabled?: boolean;
}): Promise<BugAnalysisResult> {
  const {
    bug,
    workspaceDirectories,
    refreshProjectRead = false,
    projectReadFilename = "gsy-fix-read.md",
    aiClient,
    aiExpandEnabled = true
  } = options;

  const expandedDescription =
    aiClient && aiExpandEnabled && (bug.title || bug.description)
      ? await aiClient.expandBugDescription(bug.title || "", bug.description || undefined)
      : bug.description || bug.title || "";

  const effectiveBug: NormalizedBug = {
    ...bug,
    description: expandedDescription
  };

  const keywords = extractKeywords(effectiveBug);
  const workspaceReads: WorkspaceReadResult[] = [];

  for (const workspace of workspaceDirectories) {
    const projectReadPath = path.join(workspace, projectReadFilename);
    const reused = fs.existsSync(projectReadPath) && !refreshProjectRead;
    if (!reused) {
      buildProjectReadDocument(workspace, projectReadPath, keywords);
    }

    workspaceReads.push({
      workspace,
      project_read_path: projectReadPath,
      reused
    });
  }

  const evidence = searchEvidence(workspaceDirectories, keywords, effectiveBug.repo_hint);
  const suspectedComponents = [...new Set(evidence.map((item) => item.file))].slice(0, 8);
  const evidenceSummary =
    evidence.length > 0
      ? evidence
          .slice(0, 4)
          .map((item, index) => `${index + 1}. ${path.basename(item.file)}：${item.reason}`)
          .join("\n")
      : "1. 暂未找到直接证据，建议扩大关键词或补充复现信息。";

  const conclusion = evidence.length > 0
    ? `已检查，结论是：当前问题更可能集中在 ${suspectedComponents
        .slice(0, 3)
        .map((filePath) => path.basename(filePath))
        .join("、")} 相关实现，页面、接口或服务链路中至少有一处与 bug 描述高度相关。`
    : "已检查，结论是：当前仓库内没有找到足够直接的命中证据，现有 bug 信息不足以稳定定位到具体实现。";

  const nextStep = evidence.length > 0
    ? "下一步建议：优先检查证据列表中的页面/组件是否接入真实服务，再核对对应 API、Controller、Service 或 SQL 的调用链。"
    : "下一步建议：补充更明确的模块名、接口名、截图字段或复现步骤，再重新执行 analyze_bug。";

  const analysisRemark = [
    "【Bug 分析】",
    conclusion,
    "",
    "证据：",
    evidenceSummary,
    "",
    nextStep
  ].join("\n");

  return {
    conclusion,
    evidence,
    suspected_components: suspectedComponents,
    next_step: nextStep,
    workspace_reads: workspaceReads,
    project_read_paths: workspaceReads.map((item) => item.project_read_path),
    search_keywords: keywords,
    analysis_remark: analysisRemark
  };
}

export async function appendBugRemark(
  bitableClient: FeishuBitableClient,
  config: AppConfig,
  record: FeishuRecord,
  remark: string
): Promise<{ updated: boolean; field?: string }> {
  try {
    const result = await applyBugWorkflowUpdate({
      bitableClient,
      config,
      record,
      resolution_summary: remark
    });

    return { updated: true, field: result.remarkField };
  } catch (error) {
    if (error instanceof Error && error.message === "No remark/comment field configured for resolution summary") {
      return { updated: false };
    }

    throw error;
  }
}

export function buildFixRemark(stdout: string, stderr: string): string {
  const parts = ["【Bug 修复】"];
  if (stdout.trim()) {
    parts.push(`修复摘要：${truncateText(stdout, 1200)}`);
  }
  if (stderr.trim()) {
    parts.push(`执行日志：${truncateText(stderr, 800)}`);
  }
  return parts.join("\n");
}

export function buildFailureRemark(message: string, stderr: string): string {
  const parts = ["【Bug 修复失败】", `失败原因：${message}`];
  if (stderr.trim()) {
    parts.push(`错误日志：${truncateText(stderr, 800)}`);
  }
  return parts.join("\n");
}

export async function runAgentFix(options: {
  server: McpServer;
  bug: NormalizedBug;
  analysis: BugAnalysisResult;
  workspaceDirectories: string[];
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bug-fix-"));
  const bugJsonPath = path.join(tempDir, "bug.json");
  const analysisJsonPath = path.join(tempDir, "analysis.json");

  fs.writeFileSync(bugJsonPath, JSON.stringify(options.bug, null, 2), "utf8");
  fs.writeFileSync(
    analysisJsonPath,
    JSON.stringify(
      {
        conclusion: options.analysis.conclusion,
        evidence: options.analysis.evidence,
        suspected_components: options.analysis.suspected_components,
        project_read_paths: options.analysis.project_read_paths,
        next_step: options.analysis.next_step
      },
      null,
      2
    ),
    "utf8"
  );

  const response = await options.server.server.createMessage({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "你是当前连接到 MCP 的编码代理，需要直接修复一个 bug。",
            "请在当前工作环境中完成代码修改，并在完成后只返回 JSON。",
            "JSON 格式固定为：",
            '{"success": true, "summary": "修复摘要"}',
            "如果无法完成修复，则返回：",
            '{"success": false, "summary": "失败原因"}',
            "",
            `工作目录：${options.workspaceDirectories.join(", ")}`,
            `Bug JSON 临时文件：${bugJsonPath}`,
            `分析结果 JSON 临时文件：${analysisJsonPath}`,
            "",
            "请基于这些信息直接修复 bug。"
          ].join("\n")
        }
      }
    ],
    maxTokens: 2000
  });

  const text = response.content.type === "text" ? response.content.text : "";
  let parsed: { success?: boolean; summary?: string } | null = null;
  try {
    parsed = JSON.parse(text) as { success?: boolean; summary?: string };
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed.success !== "boolean") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Current MCP agent returned a non-JSON or invalid response: ${text}`
    };
  }

  return {
    exitCode: parsed.success ? 0 : 1,
    stdout: parsed.summary ?? "",
    stderr: parsed.success ? "" : parsed.summary ?? "Current MCP agent reported failure"
  };
}
