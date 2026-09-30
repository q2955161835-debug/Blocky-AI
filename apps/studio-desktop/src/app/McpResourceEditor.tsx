import type { Resource } from "@blocky/language-schema";

type Definition = Record<string, unknown>;
function object(value: unknown): Definition {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Definition)
    : {};
}
function adapter(resource: Resource): string {
  if (typeof resource.definition.implementationRef === "string")
    return resource.definition.implementationRef;
  const ref = object(resource.definition.implementationRef);
  return ref.kind === "adapter" && typeof ref.id === "string" ? ref.id : "";
}
export function mcpResourceAdapter(resource: Resource): string {
  return adapter(resource);
}
export function isPresetMcp(resource: Resource): boolean {
  return adapter(resource) === "mcp-server-v1";
}
export function mcpResourceSecretFields(resource: Resource): string[] {
  if (!isPresetMcp(resource)) return ["endpoint", "authorization", "headers", "access", "launch"];
  return resource.definition.transport === "stdio" ? ["launch"] : ["endpoint", "headers"];
}

export function McpResourceEditor({
  resource,
  change,
}: {
  resource: Resource;
  change(resource: Resource): void;
}) {
  const definition = resource.definition;
  const ref = object(definition.implementationRef);
  const selected = ref.kind === "adapter" && typeof ref.id === "string" ? ref.id : "";
  const setTransport = (transport: "stdio" | "streamable-http") => {
    const permission = transport === "stdio" ? "mcp.local" : "network.request";
    const allowed = new Set(transport === "stdio" ? ["launch"] : ["endpoint", "headers"]);
    const withoutNetworkMode = Object.fromEntries(
      Object.entries(definition).filter(([key]) => key !== "networkMode"),
    );
    change({
      ...resource,
      scope: "user",
      capabilityRequirements: [permission],
      definition: {
        ...withoutNetworkMode,
        version: "1",
        implementationRef: { kind: "adapter", id: "mcp-server-v1" },
        transport,
        timeoutMs: Number(definition.timeoutMs) || 30000,
        permissions: [permission],
        ...(transport === "stdio" ? {} : { networkMode: "remote" }),
      },
      secretBindings: resource.secretBindings.filter((item) => allowed.has(item.fieldId)),
    });
  };

  return (
    <fieldset>
      <legend>MCP 服务连接</legend>
      <label>
        MCP 服务类型
        <select
          aria-label="MCP 服务类型"
          value={selected}
          onChange={(event) => {
            if (event.target.value === "mcp-server-v1") setTransport("stdio");
          }}
        >
          <option value="">选择服务类型</option>
          <option value="mcp-server-v1">MCP 服务（本机 stdio 或 HTTP）</option>
        </select>
      </label>
      {isPresetMcp(resource) && (
        <>
          <label>
            传输方式
            <select
              aria-label="MCP 传输方式"
              value={String(definition.transport ?? "stdio")}
              onChange={(event) => setTransport(event.target.value as "stdio" | "streamable-http")}
            >
              <option value="stdio">本机 stdio</option>
              <option value="streamable-http">Streamable HTTP</option>
            </select>
          </label>
          {definition.transport === "streamable-http" && (
            <label>
              网络范围
              <select aria-label="MCP 网络范围" value={String(definition.networkMode ?? "remote")} onChange={(e) => change({ ...resource, definition: { ...definition, networkMode: e.target.value } })}>
                <option value="remote">远程网络</option>
                <option value="loopback">本机网络</option>
              </select>
            </label>
          )}
          <label>
            超时（毫秒）
            <input aria-label="MCP 超时毫秒" type="number" min={1} max={120000} value={Number(definition.timeoutMs ?? 30000)} onChange={(e) => change({ ...resource, definition: { ...definition, timeoutMs: Number(e.target.value) } })} />
          </label>
        </>
      )}
    </fieldset>
  );
}
