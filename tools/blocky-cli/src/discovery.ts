import {
  builderOperationSchema,
  builderRequestSchema,
  draftInputSchema,
} from "@blocky/builder-protocol";
import { surfaceSpecSchema } from "@blocky/app-surface";
import { workspaceBlockShape } from "@blocky/block-catalog";
import { editorOperationSchema } from "@blocky/project-model";
import { rpaPlanSchema, rpaGrantSchema, rpaRecoverySchema, rpaBrowserStartSchema, rpaModuleInputsSchema, rpaCheckpointDeleteSchema } from "@blocky/rpa-core";
import { rpaRecordingStartSchema, rpaRecordingResultSchema, rpaRecordingStopSchema, rpaRecordingControlSchema } from "@blocky/rpa-core/recording";
import { allow, required, type Args } from "./arguments";
import { CliError, envelope } from "./protocol";
import { errorGuidance } from "./error-guidance";
import { runInputsSchema } from "./run-inputs";
export const operationsInput = builderOperationSchema.array().min(1).max(500);
const schemas = {
  "blocky.run-inputs/v1": runInputsSchema,
  "blocky.cli-operations/v1": operationsInput,
  "blocky.builder-request/v1": builderRequestSchema,
  "blocky.builder-draft/v1": draftInputSchema,
  "blocky.surface-spec/v1": surfaceSpecSchema,
  "blocky.workspace-block/v1": workspaceBlockShape,
  "blocky.editor-operation/v1": editorOperationSchema,
  "blocky.rpa/v1": rpaPlanSchema,
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
