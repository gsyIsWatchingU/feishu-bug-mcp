import { AppConfig } from "../config.js";
import { FeishuBitableClient } from "../feishu/bitable.js";
import { FeishuRecord } from "../types.js";
import { appendRemark, getRemarkFieldName } from "./helpers.js";

type WorkflowUpdateInput = {
  bitableClient: FeishuBitableClient;
  config: AppConfig;
  record?: FeishuRecord;
  bug_id?: string;
  status?: string;
  resolution_summary?: string;
  verification_result?: string;
  verification_time?: string;
};

export type WorkflowUpdateResult = {
  updatedRecord: FeishuRecord;
  updatedFields: string[];
  remarkField?: string;
};

async function resolveRecord(
  bitableClient: FeishuBitableClient,
  input: WorkflowUpdateInput
): Promise<FeishuRecord> {
  if (input.record) {
    return input.record;
  }

  if (!input.bug_id) {
    throw new Error("Either record or bug_id must be provided");
  }

  const record = await bitableClient.getRecordByBugId(input.bug_id);
  if (!record) {
    throw new Error(`Bug ${input.bug_id} was not found`);
  }

  return record;
}

export async function applyBugWorkflowUpdate(
  input: WorkflowUpdateInput
): Promise<WorkflowUpdateResult> {
  const record = await resolveRecord(input.bitableClient, input);
  const fieldsToUpdate: Record<string, unknown> = {};
  const remarkField = getRemarkFieldName(input.config);

  if (input.status) {
    fieldsToUpdate[input.config.fieldMapping.status] = input.status;
  }

  if (input.config.fieldMapping.verificationResult && input.verification_result) {
    fieldsToUpdate[input.config.fieldMapping.verificationResult] = input.verification_result;
  }

  if (input.config.fieldMapping.verificationTime && input.verification_time) {
    fieldsToUpdate[input.config.fieldMapping.verificationTime] = input.verification_time;
  }

  if (typeof input.resolution_summary === "string") {
    if (!remarkField) {
      throw new Error("No remark/comment field configured for resolution summary");
    }

    fieldsToUpdate[remarkField] = appendRemark(record.fields[remarkField], input.resolution_summary);
  }

  if (Object.keys(fieldsToUpdate).length === 0) {
    throw new Error(
      "No valid update parameters provided. Specify status, verification_result, verification_time, or resolution_summary"
    );
  }

  const updatedRecord = await input.bitableClient.updateRecord(record.record_id, fieldsToUpdate);
  return {
    updatedRecord,
    updatedFields: Object.keys(fieldsToUpdate),
    remarkField
  };
}
