import {
  builderOperationSchema,
  builderRequestSchema,
  draftInputSchema,
} from "@blocky/builder-protocol";
import { surfaceSpecSchema } from "@blocky/app-surface";
import { workspaceBlockShape } from "@blocky/block-catalog";
import { editorOperationSchema } from "@blocky/project-model";
import {
  rpaPlanSchema,
  rpaGrantSchema,
  rpaRecoverySchema,
  rpaBrowserStartSchema,
  rpaModuleInputsSchema,
  rpaCheckpointDeleteSchema,
} from "@blocky/rpa-core";
import {
  rpaRecordingStartSchema,
  rpaRecordingResultSchema,
  rpaRecordingStopSchema,
  rpaRecordingControlSchema,
} from "@blocky/rpa-core/recording";
import { allow, required, type Args } from "./arguments";
import { memoryRequestSchema } from "@blocky/runtime-core";
import {skillRequestSchema,skillMetadataSchema,delegationSchema} from '@blocky/runtime-core';
import {mediaRequestSchema,mediaMetadataSchema,decisionRequestSchema,decisionRecordSchema,evaluationAssetRequestSchema,evaluationDatasetSchema,evaluationReportSchema,evaluationCheckpointSchema,triggerConfigSchema,triggerRequestSchema,triggerRecordSchema,triggerReceiverRequestSchema,externalTriggerEventSchema} from '@blocky/runtime-core';
import { CliError, envelope } from "./protocol";
import { errorGuidance } from "./error-guidance";
import { runInputsSchema } from "./run-inputs";
import {
  workflowSummarySchema,
  workflowDecisionResultSchema,
  workflowReconciliationSchema,
} from "./workflow-schema";
import { modelRequestSchema, modelResponseSchema } from "./model-schema";
import { modelProviderSchema, connectedModelSchema } from "./model-profiles";
import { toolRequestSchema } from "./tool-schema";
import {
  ingestionOptionsSchema,
  knowledgeJudgmentSchema,
  retrievalOptionsSchema,
} from "@blocky/knowledge-core";
export const operationsInput = builderOperationSchema.array().min(1).max(500);
const schemas = {
  "blocky.model-provider/v1": modelProviderSchema,
  "blocky.connected-model/v1": connectedModelSchema,
  'blocky.media-request/v1':mediaRequestSchema,
  'blocky.media-metadata/v1':mediaMetadataSchema,
  'blocky.decision-request/v1':decisionRequestSchema,
  'blocky.decision-record/v1':decisionRecordSchema,
  'blocky.evaluation-asset-request/v1':evaluationAssetRequestSchema,
  'blocky.evaluation-dataset/v1':evaluationDatasetSchema,
  'blocky.evaluation-report/v1':evaluationReportSchema,
  'blocky.evaluation-checkpoint/v1':evaluationCheckpointSchema,
  'blocky.trigger/v1':triggerConfigSchema,
  'blocky.trigger-request/v1':triggerRequestSchema,
  'blocky.trigger-record/v1':triggerRecordSchema,
  'blocky.trigger-receiver-request/v1':triggerReceiverRequestSchema,
  'blocky.external-trigger-event/v1':externalTriggerEventSchema,
  'blocky.skill-request/v1':skillRequestSchema,
  'blocky.skill/v1':skillMetadataSchema,
  'blocky.agent-delegation/v1':delegationSchema,
  "blocky.memory-request/v1": memoryRequestSchema,
  "blocky.knowledge-ingestion/v1": ingestionOptionsSchema,
  "blocky.knowledge-judgment/v1": knowledgeJudgmentSchema,
  "blocky.knowledge-retrieval/v1": retrievalOptionsSchema,
  "blocky.tool-request/v2": toolRequestSchema,
  "blocky.model-request/v2": modelRequestSchema,
  "blocky.model-response/v2": modelResponseSchema,
  "blocky.workflow-summary/v1": workflowSummarySchema,
  "blocky.workflow-decision-result/v1": workflowDecisionResultSchema,
  "blocky.workflow-reconciliation/v1": workflowReconciliationSchema,
  "blocky.run-inputs/v1": runInputsSchema,
  "blocky.cli-operations/v1": operationsInput,
  "blocky.builder-request/v1": builderRequestSchema,
  "blocky.builder-draft/v1": draftInputSchema,
  "blocky.surface-spec/v1": surfaceSpecSchema,
  "blocky.workspace-block/v1": workspaceBlockShape,
  "blocky.editor-operation/v1": editorOperationSchema,
  "blocky.rpa/v1": rpaPlanSchema,
  "blocky.rpa-capture/v1": rpaCaptureSchema,
  "blocky.rpa-capture-view/v1": rpaCaptureViewSchema,
  "blocky.rpa-grant/v1": rpaGrantSchema,
  "blocky.rpa-recovery/v1": rpaRecoverySchema,
  "blocky.rpa-recording-start/v1": rpaRecordingStartSchema,
  "blocky.rpa-recording-result/v1": rpaRecordingResultSchema,
  "blocky.rpa-recording-stop/v1": rpaRecordingStopSchema,
  "blocky.rpa-recording-control/v1": rpaRecordingControlSchema,
  "blocky.rpa-browser-start/v1": rpaBrowserStartSchema,
  "blocky.rpa-module-inputs/v1": rpaModuleInputsSchema,
  "blocky.rpa-checkpoint-delete/v1": rpaCheckpointDeleteSchema,
};
export const discoveryHelp = [
  "command list [--query <text>] --json",
  "schema list --json",
  "schema show <schema-id> --json",
  "diagnostics explain <error-code> --json",
];
export function discoveryCommand(args: Args, commands: string[]) {
  const command = args.words.slice(0, 2).join(".");
  if (command === "command.list") {
    allow(args, ["json", "query"], 2);
    const query = args.options.has("query")
      ? required(args, "query").toLowerCase()
      : "";
    return {
      code: 0,
      result: envelope(command, {
        commands: commands
          .filter((c) => c.toLowerCase().includes(query))
          .map((usage) => ({ usage })),
        schemaIds: Object.keys(schemas),
      }),
    };
  }
  if (command === "schema.list") {
    allow(args, ["json"], 2);
    return {
      code: 0,
      result: envelope(command, { schemas: Object.keys(schemas) }),
    };
  }
  if (command === "schema.show") {
    allow(args, ["json"], 3);
    if (!Object.hasOwn(schemas, args.words[2]))
      throw new CliError(
        2,
        "BLK-CLI-002",
        "Schema 不存在。",
        "运行 schema list 获取支持的 Schema。",
      );
    const schema = schemas[args.words[2] as keyof typeof schemas];
    return {
      code: 0,
      result: envelope(command, {
        schemaId: args.words[2],
        schema: schema.toJSONSchema(),
      }),
    };
  }
  if (command === "diagnostics.explain") {
    allow(args, ["json"], 3);
    const advice = errorGuidance(args.words[2]);
    if (!advice)
      throw new CliError(
        2,
        "BLK-CLI-002",
        "没有此错误码的专门说明。",
        "保留错误码，使用 project compile 或 doctor 获取结构化诊断。",
      );
    return {
      code: 0,
      result: envelope(command, { code: args.words[2], ...advice }),
    };
  }
}
import { rpaCaptureSchema, rpaCaptureViewSchema } from "@blocky/rpa-core";
