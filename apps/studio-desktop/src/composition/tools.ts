import { invoke } from "@tauri-apps/api/core";

export type ToolAction = "call" | "discover" | "read-resource";
export type ToolRequest = {
  schemaVersion: "blocky.tool-request/v2";
  projectId: string;
  runId: string;
  requestId: string;
  resourceId: string;
  action: ToolAction;
  input: unknown;
  timeoutMs: number;
};
export type ToolReceipt = {
  projectId: string;
  requestId: string;
  resourceId: string;
  action: ToolAction;
  status:
    | "running"
    | "completed"
    | "failed"
    | "unknown"
    | "confirmed-completed"
    | "confirmed-not-applied";
  code?: string;
  startedAt?: number;
};
export type ToolStatus = { receipts: ToolReceipt[] };
export type ToolPreview = {
  requestDigest: string;
  unresolvedCalls: number;
  inputBytes: number;
  serverId?: string;
  networkMode?: string;
};
export type ToolCleanupStatus = {
  incompleteSessions: number;
  incompleteBytes: number;
  activeSessions?: number;
  unrecognizedSessions?: number;
};
export type ToolCleanupResult = { removedSessions: number; removedBytes: number };
export type ToolReconcileOutcome = "confirmed-completed" | "confirmed-not-applied";

export const toolNative = {
  preflight: (request: ToolRequest) =>
    invoke<ToolPreview>("tool_preflight", { request }),
  call: (request: ToolRequest) => invoke<unknown>("tool_call", { request }),
  cancel: (requestId: string) => invoke<void>("tool_cancel", { requestId }),
  status: (projectId: string) =>
    invoke<ToolStatus>("tool_status", { projectId }),
  reconcile: (
    projectId: string,
    requestId: string,
    outcome: ToolReconcileOutcome,
  ) => invoke<ToolReceipt>("tool_reconcile", { projectId, requestId, outcome }),
  cleanupStatus: () => invoke<ToolCleanupStatus>("tool_cleanup_status"),
  cleanup: () => invoke<ToolCleanupResult>("tool_cleanup"),
};

export function toolErrorMessage(error: unknown): string {
  const code = String(error).match(/BLK-[A-Z0-9-]{3,64}/)?.[0] ?? "BLK-TOOL-STATE";
  const message: Record<string, string> = {
    "BLK-PERM-001": "操作未获原生确认，或已取消。",
    "BLK-TOOL-CONFIG": "资源配置无效，请检查适配器、秘密引用和超时。",
    "BLK-TOOL-PERMISSION": "本机资源权限与当前操作不匹配。",
    "BLK-TOOL-SCHEMA": "输入或返回内容与声明的 Schema 不匹配。",
    "BLK-TOOL-BUSY": "另一个本机工具操作仍在结算。",
    "BLK-TOOL-RECOVERY-REQUIRED": "存在结果未知的请求。请先核对实际影响并记录结果。",
    "BLK-TOOL-CANCELLED": "请求已停止；请根据回执核对是否产生影响。",
    "BLK-TOOL-TIMEOUT": "请求超时；实际影响需要通过回执核实。",
    "BLK-MCP-RESOURCE": "MCP 服务中已找不到所选资料。",
    "BLK-MCP-TOOL": "MCP 服务中已找不到该工具。",
    "BLK-MCP-PROTOCOL": "MCP 服务返回的数据不符合协议。",
    "BLK-MCP-TOOL-ERROR": "MCP 服务报告工具执行失败。",
    "BLK-MCP-PLATFORM": "此操作当前平台不支持。",
  };
  return `${code} · ${message[code] ?? "本机工具操作失败。"}`;
}
