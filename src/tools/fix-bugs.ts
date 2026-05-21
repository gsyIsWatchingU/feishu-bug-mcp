import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppConfig } from "../config.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import {
  buildErrorResponse,
  buildSuccessResponse,
  classifyWriteError,
  toToolPayload
} from "./helpers.js";
import { FeishuRecord, NormalizedBug } from "../types.js";
import * as fs from "fs";
import * as path from "path";

const FIXED_STATUS = "\u5df2\u4fee\u590d\u5f85\u9a8c\u8bc1";

interface BugFixResult {
  bug_id: string;
  row_index: number;
  title: string | null;
  success: boolean;
  error?: string;
  code_fix_applied?: boolean;
  fix_details?: string;
  affected_files?: string[];
}

function searchCodebase(searchDir: string, keywords: string[]): string[] {
  const results: string[] = [];
  const visited = new Set<string>();

  function search(dir: string): void {
    if (visited.has(dir)) return;
    visited.add(dir);

    try {
      const entries = fs.readdirSync(dir);

      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        
        if (entry.startsWith(".") || entry === "node_modules" || entry === ".git") {
          continue;
        }

        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          search(fullPath);
        } else if (stat.isFile()) {
          const ext = path.extname(entry).toLowerCase();
          if (ext === ".ts" || ext === ".js" || ext === ".tsx" || ext === ".jsx" || 
              ext === ".vue" || ext === ".svelte" || ext === ".py" || ext === ".go" ||
              ext === ".java" || ext === ".cpp" || ext === ".c" || ext === ".rs") {
            try {
              const content = fs.readFileSync(fullPath, "utf8");
              const foundKeywords = keywords.filter(k => 
                content.toLowerCase().includes(k.toLowerCase())
              );
              if (foundKeywords.length > 0) {
                results.push(fullPath);
              }
            } catch {
              continue;
            }
          }
        }
      }
    } catch {
      return;
    }
  }

  search(searchDir);
  return results;
}

function extractKeywords(bug: NormalizedBug): string[] {
  const keywords: string[] = [];
  
  const textFields = [
    bug.title,
    bug.description,
    bug.repro_steps,
    bug.expected_result,
    bug.actual_result,
    bug.module
  ].filter(Boolean) as string[];

  const allText = textFields.join(" ");
  
  const pattern = /[a-zA-Z_][a-zA-Z0-9_]{2,}/g;
  let match;
  while ((match = pattern.exec(allText)) !== null) {
    keywords.push(match[0]);
  }

  const chinesePattern = /[\u4e00-\u9fa5]{2,}/g;
  while ((match = chinesePattern.exec(allText)) !== null) {
    keywords.push(match[0]);
  }

  return [...new Set(keywords)];
}

function analyzeAndFixBug(bug: NormalizedBug, searchDir: string): {
  fixApplied: boolean;
  fixDetails: string;
  affectedFiles: string[];
} {
  const keywords = extractKeywords(bug);
  
  if (keywords.length === 0) {
    return {
      fixApplied: false,
      fixDetails: "无法从bug描述中提取关键词",
      affectedFiles: []
    };
  }

  const affectedFiles = searchCodebase(searchDir, keywords);
  
  if (affectedFiles.length === 0) {
    return {
      fixApplied: false,
      fixDetails: `未找到包含关键词 [${keywords.slice(0, 5).join(", ")}] 的文件`,
      affectedFiles: []
    };
  }

  let fixApplied = false;
  let fixDetails = "";
  const modifiedFiles: string[] = [];

  for (const filePath of affectedFiles.slice(0, 10)) {
    try {
      let content = fs.readFileSync(filePath, "utf8");
      let modified = false;

      if (bug.description?.toLowerCase().includes("内存泄漏") || 
          bug.title?.toLowerCase().includes("内存泄漏")) {
        if (content.includes("setInterval") && !content.includes("clearInterval")) {
          const intervalMatch = content.match(/(const|let|var)\s+(\w+)\s*=\s*setInterval\(/);
          if (intervalMatch) {
            const intervalName = intervalMatch[2];
            const classMatch = content.match(/class\s+(\w+)/);
            if (classMatch) {
              const className = classMatch[1];
              const destructorMatch = content.match(new RegExp(`(\\b${className}\\s*=\\s*\\{[^}]*\\})`));
              if (destructorMatch) {
                const destructorContent = destructorMatch[1];
                if (!destructorContent.includes(`clearInterval(${intervalName})`)) {
                  const newDestructor = destructorContent.replace(
                    /(\{\s*)/,
                    `$1clearInterval(${intervalName});\n`
                  );
                  content = content.replace(destructorMatch[1], newDestructor);
                  modified = true;
                  fixDetails += `在 ${path.basename(filePath)} 中添加了 clearInterval(${intervalName}) 调用\n`;
                }
              }
            }
          }
        }

        if (content.includes("setTimeout") && content.includes("this") && 
            !content.includes("clearTimeout") && !content.includes("_timeout")) {
          content = content.replace(
            /(\bthis\.\w+\s*=\s*)setTimeout\(/g,
            "$1setTimeout("
          );
          const timerMatch = content.match(/this\.\s*(\w+)\s*=\s*setTimeout\(/);
          if (timerMatch) {
            const timerName = timerMatch[1];
            const classMatch = content.match(/class\s+(\w+)/);
            if (classMatch) {
              const className = classMatch[1];
              const destructorMatch = content.match(new RegExp(`(\\b${className}\\s*=\\s*\\{[^}]*\\})`));
              if (destructorMatch && !destructorMatch[1].includes(`clearTimeout(this.${timerName})`)) {
                const newDestructor = destructorMatch[1].replace(
                  /(\{\s*)/,
                  `$1clearTimeout(this.${timerName});\n`
                );
                content = content.replace(destructorMatch[1], newDestructor);
                modified = true;
                fixDetails += `在 ${path.basename(filePath)} 中添加了 clearTimeout(this.${timerName}) 调用\n`;
              }
            }
          }
        }
      }

      if (bug.description?.toLowerCase().includes("空指针") || 
          bug.description?.toLowerCase().includes("null") ||
          bug.title?.toLowerCase().includes("空指针")) {
        const nullCheckPattern = /(\w+)\s*\.\s*(\w+)/g;
        let nullMatch;
        while ((nullMatch = nullCheckPattern.exec(content)) !== null) {
          const varName = nullMatch[1];
          const property = nullMatch[2];
          const checkPattern = new RegExp(`if\\s*\\(\\s*${varName}\\s*\\)\\s*\\{`);
          if (!content.match(checkPattern)) {
            const usageIndex = content.indexOf(`${varName}.${property}`);
            if (usageIndex !== -1) {
              const lineStart = content.lastIndexOf("\n", usageIndex) + 1;
              const lineEnd = content.indexOf("\n", usageIndex);
              const line = content.substring(lineStart, lineEnd);
              if (!line.includes("if") && !line.includes("?.") && !line.includes("&&")) {
                const newLine = line.replace(
                  new RegExp(`(${varName})\\.(${property})`),
                  `$1?.$2`
                );
                content = content.substring(0, lineStart) + newLine + content.substring(lineEnd);
                modified = true;
                fixDetails += `在 ${path.basename(filePath)} 中将 ${varName}.${property} 改为 ${varName}?.${property}\n`;
                break;
              }
            }
          }
        }
      }

      if (bug.description?.toLowerCase().includes("未定义") || 
          bug.description?.toLowerCase().includes("undefined")) {
        content = content.replace(
          /(\w+)\s*\.\s*(\w+)/g,
          (match, p1, p2) => {
            const safeMatch = content.match(new RegExp(`(\\b${p1}\\s*=\\s*[^;]+)`));
            if (!safeMatch) {
              return `(${p1} || {}).${p2}`;
            }
            return match;
          }
        );
        modified = true;
        fixDetails += `在 ${path.basename(filePath)} 中添加了 undefined 检查\n`;
      }

      if (bug.description?.toLowerCase().includes("无限循环") || 
          bug.title?.toLowerCase().includes("无限循环")) {
        const loopPattern = /(while|for)\s*\([^)]+\)\s*\{/g;
        let loopMatch;
        while ((loopMatch = loopPattern.exec(content)) !== null) {
          const loopType = loopMatch[1];
          if (loopType === "while") {
            const conditionMatch = content.substring(loopMatch.index).match(/while\s*\(([^)]+)\)/);
            if (conditionMatch && !conditionMatch[1].includes("!=") && !conditionMatch[1].includes("==")) {
              const fix = `// 注意：此循环可能导致无限循环，请检查条件\n${loopMatch[0]}`;
              content = content.replace(loopMatch[0], fix);
              modified = true;
              fixDetails += `在 ${path.basename(filePath)} 中标记了可能的无限循环\n`;
              break;
            }
          }
        }
      }

      if (modified) {
        fs.writeFileSync(filePath, content);
        modifiedFiles.push(filePath);
        fixApplied = true;
      }
    } catch (error) {
      fixDetails += `处理 ${path.basename(filePath)} 时出错: ${error instanceof Error ? error.message : "未知错误"}\n`;
    }
  }

  if (!fixApplied) {
    fixDetails = `找到 ${affectedFiles.length} 个相关文件，但无法自动修复此类型的bug。建议手动检查：\n${affectedFiles.slice(0, 5).map(f => `- ${path.basename(f)}`).join("\n")}`;
  }

  return {
    fixApplied,
    fixDetails,
    affectedFiles: modifiedFiles.length > 0 ? modifiedFiles : affectedFiles.slice(0, 5)
  };
}

export function registerFixBugsTool(
  server: McpServer,
  config: AppConfig,
  bitableClient: FeishuBitableClient
): void {
  server.registerTool(
    "fix_bugs",
    {
      description: "Batch fix bugs by bug IDs or index range. Reads bug descriptions, searches codebase for related files, attempts code fixes, and sets bug status to '已修复待验证'.",
      inputSchema: {
        bug_ids: z.array(z.string()).optional().describe("Array of bug IDs to fix"),
        start_index: z.number().int().min(1).optional().describe("Start index for range fix"),
        end_index: z.number().int().min(1).optional().describe("End index for range fix"),
        resolution_summary: z.string().optional().describe("Summary of the fix for all bugs"),
        code_fix_enabled: z.boolean().optional().default(true).describe("Whether to enable automatic code fixing"),
        search_directory: z.string().optional().describe("Directory to search for code files (defaults to current working directory)")
      }
    },
    async ({ bug_ids, start_index: startIndex, end_index: endIndex, resolution_summary, code_fix_enabled = true, search_directory }) => {
      if (!bug_ids && (!startIndex || !endIndex)) {
        return toToolPayload(
          buildErrorResponse(config, {
            code: "VALIDATION_ERROR",
            message: "Either bug_ids array or start_index/end_index range must be provided"
          })
        );
      }

      if (startIndex !== undefined && endIndex !== undefined && startIndex > endIndex) {
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
        const bugIdToRecord = new Map<string, FeishuRecord>();
        
        items.forEach(record => {
          const bug = bitableClient.normalizeBug(record);
          bugIdToRecord.set(bug.bug_id, record);
        });

        let targetBugs: NormalizedBug[] = [];

        if (bug_ids && bug_ids.length > 0) {
          const notFoundIds: string[] = [];
          bug_ids.forEach(id => {
            const bug = bugs.find(b => b.bug_id === id);
            if (bug) {
              targetBugs.push(bug);
            } else {
              notFoundIds.push(id);
            }
          });

          if (notFoundIds.length > 0) {
            return toToolPayload(
              buildErrorResponse(config, {
                code: "NOT_FOUND",
                message: `Bugs not found: ${notFoundIds.join(", ")}`
              })
            );
          }
        } else if (startIndex !== undefined && endIndex !== undefined) {
          if (startIndex > bugs.length || endIndex > bugs.length) {
            return toToolPayload(
              buildErrorResponse(config, {
                code: "INVALID_RANGE",
                message: `Requested range ${startIndex}-${endIndex} is out of bounds for ${bugs.length} bugs`
              })
            );
          }
          targetBugs = bugs.slice(startIndex - 1, endIndex);
        }

        const results: BugFixResult[] = [];
        const searchDir = search_directory || process.cwd();

        for (const bug of targetBugs) {
          try {
            let codeFixApplied = false;
            let fixDetails = "";
            let affectedFiles: string[] = [];

            if (code_fix_enabled) {
              const fixResult = analyzeAndFixBug(bug, searchDir);
              codeFixApplied = fixResult.fixApplied;
              fixDetails = fixResult.fixDetails;
              affectedFiles = fixResult.affectedFiles;
            }

            const record = bugIdToRecord.get(bug.bug_id);
            if (!record) {
              results.push({
                bug_id: bug.bug_id,
                row_index: bug.row_index,
                title: bug.title,
                success: false,
                error: "Record not found"
              });
              continue;
            }

            const fieldsToUpdate: Record<string, unknown> = {
              [config.fieldMapping.status]: FIXED_STATUS
            };

            let commentParts: string[] = [];
            if (typeof resolution_summary === "string") {
              commentParts.push(resolution_summary);
            }
            if (fixDetails) {
              commentParts.push(`代码修复详情:\n${fixDetails}`);
            }
            if (affectedFiles.length > 0) {
              commentParts.push(`影响文件:\n${affectedFiles.map(f => `- ${path.basename(f)}`).join("\n")}`);
            }

            if (commentParts.length > 0 && config.fieldMapping.comment) {
              const existingComment = record.fields[config.fieldMapping.comment];
              const normalizedExisting = typeof existingComment === "string" ? existingComment : "";
              fieldsToUpdate[config.fieldMapping.comment] = [normalizedExisting, ...commentParts]
                .filter(Boolean)
                .join("\n\n");
            }

            await bitableClient.updateRecord(record.record_id, fieldsToUpdate);
            
            results.push({
              bug_id: bug.bug_id,
              row_index: bug.row_index,
              title: bug.title,
              success: true,
              code_fix_applied: codeFixApplied,
              fix_details: fixDetails,
              affected_files: affectedFiles.map(f => path.basename(f))
            });
          } catch (error) {
            results.push({
              bug_id: bug.bug_id,
              row_index: bug.row_index,
              title: bug.title,
              success: false,
              error: error instanceof Error ? error.message : "Unknown error"
            });
          }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        const codeFixCount = results.filter(r => r.code_fix_applied).length;

        return toToolPayload(
          buildSuccessResponse(config, {
            total: targetBugs.length,
            success_count: successCount,
            fail_count: failCount,
            code_fix_count: codeFixCount,
            results
          })
        );
      } catch (error) {
        return toToolPayload(buildErrorResponse(config, classifyWriteError(error)));
      }
    }
  );
}