import { useEffect, useRef, useState } from "react";
import type { Resource } from "@blocky/language-schema";
import {
  toolNative,
  toolErrorMessage,
  type ToolAction,
  type ToolCleanupStatus,
  type ToolPreview,
  type ToolReceipt,
  type ToolRequest,
  type ToolReconcileOutcome,
  type ToolStatus,
} from "../composition/tools";

type McpResource = { uriRef: string; name?: string; mimeType?: string };
const mcpUriRef = /^uri-[a-f0-9]{64}$/;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function errorText(error: unknown): string {
  return toolErrorMessage(error);
}
function mcpResources(value: unknown): McpResource[] {
  if (!record(value) || !Array.isArray(value.resources)) return [];
  return value.resources.flatMap((item) => {
    if (!record(item) || typeof item.uriRef !== "string" || !mcpUriRef.test(item.uriRef))
      return [];
    return [{
      uriRef: item.uriRef,
      ...(typeof item.name === "string" ? { name: item.name } : {}),
      ...(typeof item.mimeType === "string" ? { mimeType: item.mimeType } : {}),
    }];
  });
}
function statusReceipts(value: ToolStatus | undefined): ToolReceipt[] {
  return Array.isArray(value?.receipts) ? value.receipts : [];
}
function timeout(resource: Resource): number {
  const value = resource.definition.timeoutMs;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 120000
    ? value
    : 30000;
}

export function ToolOperationsPanel({
  resource,
  projectId,
  onBusyChange,
}: {
  resource: Resource;
  projectId: string;
  onBusyChange?(busy: boolean): void;
}) {
  const implementation = resource.definition.implementationRef;
  const adapter =
    implementation && typeof implementation === "object" && !Array.isArray(implementation) &&
    implementation.kind === "adapter" && typeof implementation.id === "string"
      ? implementation.id
      : "";
  const mcpServer = resource.kind === "mcp" && adapter === "mcp-server-v1";
  const tool =
    resource.kind === "tool" &&
    ["http-json-v1", "search-json-v1", "mcp-tool-v1"].includes(adapter);
  const [inputText, setInputText] = useState("{}");
  const [selectedUriRef, setSelectedUriRef] = useState("");
  const [resources, setResources] = useState<McpResource[]>([]);
  const [result, setResult] = useState<unknown>();
  const [preview, setPreview] = useState<ToolPreview>();
  const [status, setStatus] = useState<ToolStatus>();
  const [cleanupStatus, setCleanupStatus] = useState<ToolCleanupStatus>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [statusError, setStatusError] = useState("");
  const activeRequest = useRef<ToolRequest | undefined>(undefined);
  const busyRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let current = true;
    void Promise.all([
      toolNative.status(projectId),
      toolNative.cleanupStatus(),
    ])
      .then(([currentStatus, currentCleanup]) => {
        if (!current) return;
        setStatus(currentStatus);
        setCleanupStatus(currentCleanup);
        setStatusError("");
      })
      .catch((error: unknown) => {
        if (current) setStatusError(errorText(error));
      });
    return () => {
      current = false;
      mounted.current = false;
      onBusyChange?.(false);
    };
  }, [projectId, resource.resourceId, onBusyChange]);

  const refreshStatus = async () => {
    try {
      const current = await toolNative.status(projectId);
      if (mounted.current) {
        setStatus(current);
        setStatusError("");
      }
    } catch (error) {
      if (mounted.current) setStatusError(errorText(error));
    }
  };
  const refreshCleanupStatus = async () => {
    try {
      const current = await toolNative.cleanupStatus();
      if (mounted.current) setCleanupStatus(current);
    } catch (error) {
      if (mounted.current) setStatusError(errorText(error));
    }
  };
  const beginBusy = () => {
    busyRef.current = true;
    setBusy(true);
    onBusyChange?.(true);
  };
  const finishBusy = () => {
    busyRef.current = false;
    activeRequest.current = undefined;
    if (mounted.current) {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const execute = async (action: ToolAction, input: unknown) => {
    if (busyRef.current) return;
    const request: ToolRequest = {
      schemaVersion: "blocky.tool-request/v2",
      projectId,
      runId: `toolrun-${crypto.randomUUID()}`,
      requestId: `toolreq-${crypto.randomUUID()}`,
      resourceId: resource.resourceId,
      action,
      input,
      timeoutMs: timeout(resource),
    };
    activeRequest.current = request;
    beginBusy();
    setMessage("正在核对资源并准备本机请求。");
    setResult(undefined);
    setPreview(undefined);
    if (action === "discover") {
      setResources([]);
      setSelectedUriRef("");
    }
    try {
      const currentPreview = await toolNative.preflight(request);
      if (mounted.current) setPreview(currentPreview);
      if (currentPreview.unresolvedCalls > 0)
        throw Error("BLK-TOOL-RECOVERY-REQUIRED");
      if (mounted.current) setMessage("等待本机确认。");
      const actual = await toolNative.call(request);
      if (mounted.current) {
        setResult(actual);
        if (action === "discover") setResources(mcpResources(actual));
        setMessage("本机已返回实际操作结果。");
      }
    } catch (error) {
      if (mounted.current) setMessage(errorText(error));
    } finally {
      await refreshStatus();
      finishBusy();
    }
  };

  const callTool = () => {
    let input: unknown;
    try {
      input = JSON.parse(inputText);
    } catch {
      setMessage("BLK-TOOL-INVALID · 输入必须是有效 JSON。");
      return;
    }
    void execute("call", input);
  };
  const discover = () => void execute("discover", {});
  const readSelectedResource = () => {
    if (!mcpUriRef.test(selectedUriRef)) {
      setMessage("BLK-MCP-RESOURCE · 请先选择发现结果中的资料。");
      return;
    }
    void execute("read-resource", { uriRef: selectedUriRef });
  };
  const stop = async () => {
    const request = activeRequest.current;
    if (!request || !busyRef.current) return;
    setMessage("已发送停止请求；等待本机完成结算和状态读取。");
    try {
      await toolNative.cancel(request.requestId);
    } catch (error) {
      if (mounted.current) setMessage(errorText(error));
    }
  };
  const reconcile = async (receipt: ToolReceipt, outcome: ToolReconcileOutcome) => {
    if (busyRef.current || receipt.status !== "unknown") return;
    beginBusy();
    setMessage("正在请本机确认核对结果。");
    try {
      await toolNative.reconcile(projectId, receipt.requestId, outcome);
      if (mounted.current)
        setMessage(outcome === "confirmed-completed" ? "已记录：操作已经生效。" : "已记录：操作没有生效。原调用未重发。");
    } catch (error) {
      if (mounted.current) setMessage(errorText(error));
    } finally {
      await refreshStatus();
      finishBusy();
    }
  };
  const cleanup = async () => {
    if (busyRef.current) return;
    beginBusy();
    setMessage("等待本机确认清理已识别的临时资料。");
    try {
      const removed = await toolNative.cleanup();
      if (mounted.current)
        setMessage(`已清理 ${removed.removedSessions} 个会话，共 ${removed.removedBytes} 字节。`);
    } catch (error) {
      if (mounted.current) setMessage(errorText(error));
    } finally {
      await refreshCleanupStatus();
      finishBusy();
    }
  };

  const receipts = statusReceipts(status).filter((receipt) => receipt.resourceId === resource.resourceId);
  const unknown = receipts.filter((receipt) => receipt.status === "unknown");
  const output = result === undefined ? "" : JSON.stringify(result, null, 2) ?? String(result);

  return (
    <section aria-label="工具操作面板">
      <h3>本机工具操作 · {resource.displayName}</h3>
      {tool && (
        <fieldset disabled={busy}>
          <legend>调用工具</legend>
          <label>
            工具输入 JSON
            <textarea aria-label="工具输入 JSON" value={inputText} onChange={(event) => setInputText(event.target.value)} />
          </label>
          <button onClick={callTool}>调用已保存工具</button>
        </fieldset>
      )}
      {mcpServer && (
        <fieldset disabled={busy}>
          <legend>MCP 服务</legend>
          <button onClick={discover}>发现 MCP 工具和资料</button>
          <label>
            MCP 资料
            <select aria-label="MCP 资料" value={selectedUriRef} onChange={(event) => setSelectedUriRef(event.target.value)}>
              <option value="">请选择发现结果中的资料</option>
              {resources.map((item) => (
                <option key={item.uriRef} value={item.uriRef}>
                  {item.name ?? "未命名资料"}{item.mimeType ? ` · ${item.mimeType}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!selectedUriRef} onClick={readSelectedResource}>读取所选资料</button>
        </fieldset>
      )}
      {busy && activeRequest.current && (
        <button onClick={() => void stop()}>停止工具请求</button>
      )}
      {preview && (
        <p>
          请求预览：{preview.inputBytes} 字节；未核实请求 {preview.unresolvedCalls} 个。实际目标由本机确认窗口展示。
        </p>
      )}
      {result !== undefined && <pre aria-label="工具返回 JSON">{output}</pre>}
      {statusError && <p role="alert">{statusError}</p>}
      <section aria-label="工具回执状态">
        <h4>操作状态</h4>
        {receipts.length ? (
          <ul>
            {receipts.map((receipt) => (
              <li key={receipt.requestId}>
                {receipt.requestId} · {receipt.status}{receipt.code ? ` · ${receipt.code}` : ""}
                {receipt.status === "unknown" && (
                  <div>
                    <p>结果未知。请核对实际目标状态，再选择下面一项；本机还会再次确认。记录结果不会重发原调用。</p>
                    <button disabled={busy} onClick={() => void reconcile(receipt, "confirmed-completed")}>记录结果已生效</button>
                    <button disabled={busy} onClick={() => void reconcile(receipt, "confirmed-not-applied")}>记录结果未生效</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : <p>此项目暂无操作回执。</p>}
      </section>
      <section aria-label="工具临时资料清理">
        <h4>临时资料</h4>
        {cleanupStatus ? (
          <p>已识别未完成会话 {cleanupStatus.incompleteSessions} 个，占用 {cleanupStatus.incompleteBytes} 字节；活动 {cleanupStatus.activeSessions ?? 0} 个，未识别 {cleanupStatus.unrecognizedSessions ?? 0} 个。</p>
        ) : <p>正在读取清理状态。</p>}
        <button disabled={busy || !cleanupStatus?.incompleteSessions} onClick={() => void cleanup()}>清理已识别的临时资料</button>
        <button disabled={busy} onClick={() => void refreshCleanupStatus()}>刷新清理状态</button>
      </section>
      <p role="status">{message}</p>
    </section>
  );
}
