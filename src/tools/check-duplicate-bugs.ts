import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppConfig } from "../config.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import {
  appendRemark,
  buildErrorResponse,
  buildSuccessResponse,
  classifyWriteError,
  getRemarkFieldName,
  toToolPayload
} from "./helpers.js";
import { FeishuRecord, NormalizedBug } from "../types.js";

export function registerCheckDuplicateBugsTool(
  server: McpServer,
  config: AppConfig,
  bitableClient: FeishuBitableClient
): void {
  server.registerTool(
    "check_duplicate_bugs",
    {
      description:
        "通过文本相似度查找重复 bug。对于重复组中的后续 bug，可自动在备注中标记其对应的主 bug。",
      inputSchema: {
        threshold: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .default(0.7)
          .describe("相似度阈值 (0-1)，越高越严格"),
        auto_mark: z.boolean().optional().default(true).describe("是否自动在备注中标记重复 bug")
      }
    },
    async ({ threshold = 0.7, auto_mark = true }) => {
      try {
        const { items } = await bitableClient.listAllRecords();
        const bugs = bitableClient.normalizeAndOrderBugs(items);
        const bugIdToRecord = new Map<string, FeishuRecord>();

        items.forEach((record) => {
          const bug = bitableClient.normalizeBug(record);
          bugIdToRecord.set(bug.bug_id, record);
        });

        const duplicateGroups = findDuplicateGroups(bugs, threshold);

        const updateResults: {
          bug_id: string;
          row_index: number;
          title: string | null;
          duplicate_of_bug_id: string;
          duplicate_of_row_index: number;
          marked: boolean;
          error?: string;
        }[] = [];

        if (auto_mark) {
          for (const group of duplicateGroups) {
            if (group.length < 2) continue;

            const firstBug = group[0];

            for (let i = 1; i < group.length; i++) {
              const duplicateBug = group[i];
              const record = bugIdToRecord.get(duplicateBug.bug_id);

              if (!record) {
                updateResults.push({
                  bug_id: duplicateBug.bug_id,
                  row_index: duplicateBug.row_index,
                  title: duplicateBug.title,
                  duplicate_of_bug_id: firstBug.bug_id,
                  duplicate_of_row_index: firstBug.row_index,
                  marked: false,
                  error: "Record not found"
                });
                continue;
              }

              try {
                const remarkField = getRemarkFieldName(config);
                if (!remarkField) {
                  updateResults.push({
                    bug_id: duplicateBug.bug_id,
                    row_index: duplicateBug.row_index,
                    title: duplicateBug.title,
                    duplicate_of_bug_id: firstBug.bug_id,
                    duplicate_of_row_index: firstBug.row_index,
                    marked: false,
                    error: "No remark or comment field configured"
                  });
                  continue;
                }

                const duplicateNote = `该 bug 与第 ${firstBug.row_index} 条 bug 重复（主 bug: ${firstBug.bug_id}）。`;
                const existingRemark =
                  typeof record.fields[remarkField] === "string" ? String(record.fields[remarkField]) : "";

                if (existingRemark.includes(duplicateNote)) {
                  updateResults.push({
                    bug_id: duplicateBug.bug_id,
                    row_index: duplicateBug.row_index,
                    title: duplicateBug.title,
                    duplicate_of_bug_id: firstBug.bug_id,
                    duplicate_of_row_index: firstBug.row_index,
                    marked: true,
                    error: "Already marked as duplicate"
                  });
                  continue;
                }

                await bitableClient.updateRecord(record.record_id, {
                  [remarkField]: appendRemark(record.fields[remarkField], duplicateNote)
                });

                updateResults.push({
                  bug_id: duplicateBug.bug_id,
                  row_index: duplicateBug.row_index,
                  title: duplicateBug.title,
                  duplicate_of_bug_id: firstBug.bug_id,
                  duplicate_of_row_index: firstBug.row_index,
                  marked: true
                });
              } catch (error) {
                updateResults.push({
                  bug_id: duplicateBug.bug_id,
                  row_index: duplicateBug.row_index,
                  title: duplicateBug.title,
                  duplicate_of_bug_id: firstBug.bug_id,
                  duplicate_of_row_index: firstBug.row_index,
                  marked: false,
                  error: error instanceof Error ? error.message : "Unknown error"
                });
              }
            }
          }
        } else {
          for (const group of duplicateGroups) {
            if (group.length < 2) continue;

            const firstBug = group[0];

            for (let i = 1; i < group.length; i++) {
              const duplicateBug = group[i];
              updateResults.push({
                bug_id: duplicateBug.bug_id,
                row_index: duplicateBug.row_index,
                title: duplicateBug.title,
                duplicate_of_bug_id: firstBug.bug_id,
                duplicate_of_row_index: firstBug.row_index,
                marked: false
              });
            }
          }
        }

        const markedCount = updateResults.filter((result) => result.marked).length;
        const notMarkedCount = updateResults.filter((result) => !result.marked).length;

        return toToolPayload(
          buildSuccessResponse(config, {
            total_groups: duplicateGroups.length,
            total_duplicates: updateResults.length,
            marked_count: markedCount,
            not_marked_count: notMarkedCount,
            duplicate_groups: duplicateGroups.map((group) => ({
              primary_bug: {
                bug_id: group[0].bug_id,
                row_index: group[0].row_index,
                title: group[0].title
              },
              duplicates: group.slice(1).map((bug) => ({
                bug_id: bug.bug_id,
                row_index: bug.row_index,
                title: bug.title
              }))
            })),
            update_results: updateResults
          })
        );
      } catch (error) {
        return toToolPayload(buildErrorResponse(config, classifyWriteError(error)));
      }
    }
  );
}

function findDuplicateGroups(bugs: NormalizedBug[], threshold: number): NormalizedBug[][] {
  const groups: NormalizedBug[][] = [];
  const processed = new Set<string>();

  for (let i = 0; i < bugs.length; i++) {
    const bug1 = bugs[i];
    if (processed.has(bug1.bug_id)) continue;

    const group: NormalizedBug[] = [bug1];
    processed.add(bug1.bug_id);

    for (let j = i + 1; j < bugs.length; j++) {
      const bug2 = bugs[j];
      if (processed.has(bug2.bug_id)) continue;

      const similarity = calculateSimilarity(bug1, bug2);
      if (similarity >= threshold) {
        group.push(bug2);
        processed.add(bug2.bug_id);
      }
    }

    if (group.length > 1) {
      groups.push(group);
    }
  }

  return groups.sort((left, right) => right.length - left.length);
}

function calculateSimilarity(bug1: NormalizedBug, bug2: NormalizedBug): number {
  const text1 = getBugTextContent(bug1);
  const text2 = getBugTextContent(bug2);

  const words1 = text1.toLowerCase().split(/\s+/).filter((word) => word.length > 1);
  const words2 = text2.toLowerCase().split(/\s+/).filter((word) => word.length > 1);

  if (words1.length === 0 || words2.length === 0) {
    return 0;
  }

  const set1 = new Set(words1);
  const set2 = new Set(words2);

  const intersection = [...set1].filter((word) => set2.has(word)).length;
  const union = set1.size + set2.size - intersection;

  if (union === 0) return 0;

  const jaccard = intersection / union;
  const overlap = calculateOverlap(words1, words2);
  return (jaccard + overlap) / 2;
}

function getBugTextContent(bug: NormalizedBug): string {
  const fields = [
    bug.title,
    bug.description,
    bug.repro_steps,
    bug.expected_result,
    bug.actual_result,
    bug.module
  ];
  return fields.filter((field) => field != null).join(" ");
}

function calculateOverlap(words1: string[], words2: string[]): number {
  const commonWords = new Set<string>();
  let matches = 0;

  for (const word1 of words1) {
    for (const word2 of words2) {
      if (word1 === word2 || word1.includes(word2) || word2.includes(word1)) {
        if (!commonWords.has(word1)) {
          matches++;
          commonWords.add(word1);
        }
      }
    }
  }

  return matches / Math.max(words1.length, words2.length);
}
