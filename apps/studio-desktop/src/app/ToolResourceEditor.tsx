import type { Json, Project, Resource } from "@blocky/language-schema";

type Definition = Record<string, Json>;
const toolAdapters = [
  ["http-json-v1", "HTTP JSON 工具"],
  ["search-json-v1", "搜索工具"],
  ["mcp-tool-v1", "MCP 工具"],
  ["module-tool-v1", "项目模块工具"],
] as const;

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
function schemaChoices(project: Project): { id: string; path: string; value: Json }[] {
  return Object.entries(project.schemas)
    .flatMap(([path, value]) => {
      const match = /^schemas\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.json$/.exec(path);
      return match ? [{ id: match[1]!, path, value }] : [];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}
function schemaReference(id: string) {
  return { kind: "schema", id };
}
function definitionFor(adapterId: string, project: Project): Definition {
  const schemas = schemaChoices(project);
  const input = schemas[0];
  const output = schemas.at(-1);
  return {
    version: "1",
    permissions: [],
    implementationRef: { kind: "adapter", id: adapterId },
    inputSchemaRef: schemaReference(input?.id ?? "input"),
    outputSchemaRef: schemaReference(output?.id ?? "output"),
    inputSchemaJson: JSON.stringify(input?.value ?? { type: "object" }, null, 2) ?? "{}",
    outputSchemaJson: JSON.stringify(output?.value ?? { type: "object" }, null, 2) ?? "{}",
    timeoutMs: 30000,
    ...(adapterId === "http-json-v1" || adapterId === "search-json-v1"
      ? { method: "POST", networkMode: "remote" }
      : {}),
    ...(adapterId === "mcp-tool-v1" ? { mcpResourceId: "", toolName: "" } : {}),
    ...(adapterId === "module-tool-v1" ? { moduleId: "", exportId: "" } : {}),
  };
}
function moduleSchema(project: Project, value?: string) {
  if (!value) return undefined;
  const path = value.startsWith("schemas/") ? value : `schemas/${value}.json`;
  const match = /^schemas\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.json$/.exec(path);
  return match && Object.hasOwn(project.schemas, path)
    ? { id: match[1]!, value: project.schemas[path]! }
    : undefined;
}

export function toolResourceAdapter(resource: Resource): string {
  return adapter(resource);
}
export function toolResourceSecretFields(resource: Resource): string[] {
  return adapter(resource) === "http-json-v1" || adapter(resource) === "search-json-v1"
    ? ["endpoint", "headers"]
    : adapter(resource) === "mcp-tool-v1" || adapter(resource) === "module-tool-v1"
      ? []
      : ["endpoint", "headers", "access"];
}
export function isPresetTool(resource: Resource): boolean {
  return toolAdapters.some(([id]) => id === adapter(resource));
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function toolResourceSchemaError(resource: Resource, project: Project): string {
  if (!isPresetTool(resource)) return "";
  const definition = object(resource.definition);
  for (const which of ["input", "output"] as const) {
    const reference = object(definition[`${which}SchemaRef`]);
    const id = reference.id;
    if (typeof id !== "string" || !id) return `请选择${which === "input" ? "输入" : "输出"} Schema。`;
    const expected = project.schemas[`schemas/${id}.json`];
    if (expected === undefined) return `当前项目缺少 Schema 引用：${id}。`;
    let actual: unknown;
    try {
      actual = JSON.parse(String(definition[`${which}SchemaJson`] ?? ""));
    } catch {
      return `${which === "input" ? "输入" : "输出"} JSON Schema 格式无效。`;
    }
    if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected)))
      return `${which === "input" ? "输入" : "输出"} JSON Schema 必须与项目引用内容一致。`;
  }
  return "";
}

export function ToolResourceEditor({
  resource,
  project,
  userResources,
  change,
}: {
  resource: Resource;
  project: Project;
  userResources: Resource[];
  change(resource: Resource): void;
}) {
  const definition = object(resource.definition);
  const selected = adapter(resource);
  const schemas = schemaChoices(project);
  const mcpServers = userResources.filter(
    (item) =>
      item.kind === "mcp" &&
      item.scope === "user" &&
      object(item.definition.implementationRef).id === "mcp-server-v1",
  );
  const modules = project.manifest.modules.flatMap((module) => {
    const exports = module.exports.filter((item) => item.kind === "tool");
    return exports.map((item) => ({ module, export: item }));
  });
  const set = (patch: Definition, nextScope?: Resource["scope"]) =>
    change({
      ...resource,
      ...(nextScope ? { scope: nextScope } : {}),
      definition: { ...resource.definition, ...patch },
    });
  const setSchema = (which: "input" | "output", id: string) => {
    const schema = schemas.find((item) => item.id === id);
    const key = `${which}SchemaRef`;
    const jsonKey = `${which}SchemaJson`;
    set({
      [key]: schemaReference(id),
      ...(schema ? { [jsonKey]: JSON.stringify(schema.value, null, 2) ?? "{}" } : {}),
    });
  };

  return (
    <fieldset>
      <legend>工具连接</legend>
      <label>
        工具类型
        <select
          aria-label="工具类型"
          value={selected}
          onChange={(event) => {
            const next = event.target.value;
            if (!next) return;
            const defaults = definitionFor(next, project);
            const permissions =
              next === "module-tool-v1"
                ? ["module.execute"]
                : next === "http-json-v1" || next === "search-json-v1"
                  ? ["network.request"]
                  : [];
            defaults.permissions = permissions;
            const keep = new Set(toolResourceSecretFields(resource).filter((key) =>
              next === "http-json-v1" || next === "search-json-v1"
                ? ["endpoint", "headers"].includes(key)
                : false,
            ));
            change({
              ...resource,
              scope: next === "module-tool-v1" ? "project" : "user",
              definition: defaults,
              capabilityRequirements: permissions,
              secretBindings: resource.secretBindings.filter((item) => keep.has(item.fieldId)),
            });
          }}
        >
          <option value="">选择工具类型</option>
          {toolAdapters.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </label>
      {selected === "http-json-v1" || selected === "search-json-v1" ? (
        <>
          <label>
            请求方法
            <select aria-label="请求方法" value={String(definition.method ?? "POST")} onChange={(e) => set({ method: e.target.value })}>
              <option value="GET">GET</option><option value="POST">POST</option>
            </select>
          </label>
          <label>
            网络范围
            <select aria-label="网络范围" value={String(definition.networkMode ?? "remote")} onChange={(e) => set({ networkMode: e.target.value })}>
              <option value="remote">远程网络</option><option value="loopback">本机网络</option>
            </select>
          </label>
        </>
      ) : null}
      {selected === "mcp-tool-v1" && (
        <>
          <label>
            MCP 服务
            <select
              aria-label="MCP 服务"
              value={String(definition.mcpResourceId ?? "")}
              onChange={(e) => {
                const server = mcpServers.find((item) => item.resourceId === e.target.value);
                const transport = server ? object(server.definition).transport : "";
                const permission = transport === "stdio" ? "mcp.local" : "network.request";
                set({ mcpResourceId: e.target.value, permissions: server ? [permission] : [] }, undefined);
                change({
                  ...resource,
                  scope: "user",
                  definition: { ...resource.definition, mcpResourceId: e.target.value, permissions: server ? [permission] : [] },
                  capabilityRequirements: server ? [permission] : [],
                });
              }}
            >
              <option value="">选择已配置的本机 MCP 服务</option>
              {mcpServers.map((item) => <option key={item.resourceId} value={item.resourceId}>{item.displayName}</option>)}
            </select>
          </label>
          <label>
            MCP 工具名称
            <input aria-label="MCP 工具名称" maxLength={128} value={String(definition.toolName ?? "")} onChange={(e) => set({ toolName: e.target.value })} />
          </label>
        </>
      )}
      {selected === "module-tool-v1" && (
        <>
          <label>
            模块
            <select
              aria-label="工具模块"
              value={String(definition.moduleId ?? "")}
              onChange={(e) => {
                const module = project.manifest.modules.find((item) => item.moduleId === e.target.value);
                const exported = module?.exports.find((item) => item.kind === "tool");
                const input = moduleSchema(project, exported?.inputSchemaRef);
                const output = moduleSchema(project, exported?.outputSchemaRef);
                change({
                  ...resource,
                  scope: "project",
                  capabilityRequirements: ["module.execute"],
                  definition: {
                    ...resource.definition,
                    moduleId: module?.moduleId ?? "",
                    exportId: exported?.exportId ?? "",
                    permissions: ["module.execute"],
                    ...(input ? { inputSchemaRef: schemaReference(input.id), inputSchemaJson: JSON.stringify(input.value, null, 2) } : {}),
                    ...(output ? { outputSchemaRef: schemaReference(output.id), outputSchemaJson: JSON.stringify(output.value, null, 2) } : {}),
                  },
                });
              }}
            >
              <option value="">选择提供工具的模块</option>
              {[...new Map(modules.map(({ module }) => [module.moduleId, module])).values()].map((module) => <option key={module.moduleId} value={module.moduleId}>{module.displayName}</option>)}
            </select>
          </label>
          <label>
            导出工具
            <select
              aria-label="导出工具"
              value={String(definition.exportId ?? "")}
              onChange={(e) => {
                const found = modules.find(({ module, export: item }) => module.moduleId === definition.moduleId && item.exportId === e.target.value);
                const input = moduleSchema(project, found?.export.inputSchemaRef);
                const output = moduleSchema(project, found?.export.outputSchemaRef);
                set({
                  exportId: found?.export.exportId ?? "",
                  ...(input ? { inputSchemaRef: schemaReference(input.id), inputSchemaJson: JSON.stringify(input.value, null, 2) } : {}),
                  ...(output ? { outputSchemaRef: schemaReference(output.id), outputSchemaJson: JSON.stringify(output.value, null, 2) } : {}),
                }, "project");
              }}
            >
              <option value="">选择模块导出</option>
              {modules.filter(({ module }) => module.moduleId === definition.moduleId).map(({ export: item }) => <option key={item.exportId} value={item.exportId}>{item.displayName}</option>)}
            </select>
          </label>
        </>
      )}
      {isPresetTool(resource) && (
        <>
          {selected !== "module-tool-v1" && selected !== "mcp-tool-v1" && (
            <label>
              超时（毫秒）
              <input aria-label="工具超时毫秒" type="number" min={1} max={120000} value={Number(definition.timeoutMs ?? 30000)} onChange={(e) => set({ timeoutMs: Number(e.target.value) })} />
            </label>
          )}
          <label>
            输入 Schema
            <select aria-label="输入 Schema 引用" value={String(object(definition.inputSchemaRef).id ?? "")} onChange={(e) => setSchema("input", e.target.value)}>
              {schemas.map((item) => <option key={item.id} value={item.id}>{item.path}</option>)}
            </select>
            <textarea aria-label="输入 JSON Schema" value={String(definition.inputSchemaJson ?? "")} onChange={(e) => set({ inputSchemaJson: e.target.value })} />
          </label>
          <label>
            输出 Schema
            <select aria-label="输出 Schema 引用" value={String(object(definition.outputSchemaRef).id ?? "")} onChange={(e) => setSchema("output", e.target.value)}>
              {schemas.map((item) => <option key={item.id} value={item.id}>{item.path}</option>)}
            </select>
            <textarea aria-label="输出 JSON Schema" value={String(definition.outputSchemaJson ?? "")} onChange={(e) => set({ outputSchemaJson: e.target.value })} />
          </label>
        </>
      )}
    </fieldset>
  );
}
