import { memoryRequestSchema } from "@blocky/runtime-core";
import { allow, required, type Args } from "./arguments";
import { readJsonArtifact } from "./artifacts";
import { nativeUserOperation } from "./native-store";
import { CliError, envelope } from "./protocol";
export const memoryHelp = [
  "memory preflight --request <memory-request.json> --json",
  "memory execute --request <memory-request.json> --approve <sha256> --json",
];
export async function memoryCommand(args: Args, signal: AbortSignal) {
  if (args.words[0] !== "memory") return;
  const action=args.words[1];
  if (!["preflight","execute"].includes(action)) throw new CliError(2,"BLK-CLI-002","记忆命令不存在。","运行 command list --query memory。");
  allow(args,["request","json",...(action==="execute"?["approve"]:[])],2);
  const parsed=memoryRequestSchema.safeParse(await readJsonArtifact(required(args,"request"),65536));
  if(!parsed.success) throw new CliError(3,"BLK-MEMORY-001","记忆请求无效。","运行 schema show blocky.memory-request/v1；写入和删除需读回 expectedVersion，冲突后重新读取。");
  const fields:Record<string,unknown>={request:parsed.data};
  if(action==="execute") {
    const requestDigest=required(args,"approve");
    if(!/^[a-f0-9]{64}$/.test(requestDigest)) throw new CliError(2,"BLK-CLI-002","审批摘要无效。");
    fields.approval={approved:true,requestDigest};
  }
  signal.throwIfAborted();
  const result=await nativeUserOperation(action==="execute"?"agent-memory-manage":"agent-memory-manage-preflight",fields,signal);
  return {code:0,result:envelope(`memory.${action}`,result)};
}
