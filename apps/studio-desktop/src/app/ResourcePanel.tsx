import { useState } from "react";
import {
  resourceDefinitions,
  validateResource,
  upsertProjectResource,
  removeProjectResource,
  analyzeResourceReferences,
  referenceUserResource,
  type ResourceFieldSchema,
} from "@blocky/resource-registry";
import type { Resource } from "@blocky/language-schema";
import type { Studio } from "../composition/useStudio";
import { SecretBindings } from "./SecretBindings";
import {
  ModelResourceEditor,
  modelResourceError,
  modelSecretFields,
} from "./ModelResourceEditor";
import {
  isPresetTool,
  toolResourceAdapter,
  toolResourceSchemaError,
  toolResourceSecretFields,
  ToolResourceEditor,
} from "./ToolResourceEditor";
import {
  isPresetMcp,
  mcpResourceAdapter,
  mcpResourceSecretFields,
  McpResourceEditor,
} from "./McpResourceEditor";
import { ToolOperationsPanel } from "./ToolOperationsPanel";
import { KnowledgePanel } from "./KnowledgePanel";
import { MemoryPanel } from "./MemoryPanel";
import { knowledgeNative } from "../composition/knowledge";
import {
  knowledgeResource,
  resourceRetrieval,
  type RetrievalOptions,
} from "@blocky/knowledge-core";
function initial(schema: ResourceFieldSchema): unknown {
  if (schema.enum) return schema.enum[0];
  if (schema.type === "object")
    return Object.fromEntries(
      (schema.required ?? []).map((key) => [
        key,
        initial(schema.properties![key]),
      ]),
    );
  if (schema.type === "array") return [];
  if (schema.type === "number") return schema.minimum ?? 0;
  return schema.type === "boolean" ? false : "";
}
function hostAdapter(resource: Resource): string {
  const implementation = resource.definition.implementationRef;
  if (
    !implementation ||
    typeof implementation !== "object" ||
    Array.isArray(implementation)
  )
    return "";
  return implementation.kind === "adapter" && typeof implementation.id === "string"
    ? implementation.id
    : "";
}
function supportsHostOperation(resource: Resource): boolean {
  if (resource.scope !== "user") return false;
  const adapter = hostAdapter(resource);
  return (
    (resource.kind === "tool" &&
      ["http-json-v1", "search-json-v1", "mcp-tool-v1"].includes(adapter)) ||
    (resource.kind === "mcp" && adapter === "mcp-server-v1")
  );
}
function Fields({
  schema,
  value,
  change,
  path = "definition",
}: {
  schema: ResourceFieldSchema;
  value: unknown;
  change(value: unknown): void;
  path?: string;
}) {
  if (schema.type === "object") {
    const object = (value && typeof value === "object" ? value : {}) as Record<
      string,
      unknown
    >;
    return (
      <fieldset>
        <legend>{path.split(".").at(-1)}</legend>
        {Object.entries(schema.properties ?? {}).map(([key, child]) => (
          <div key={key}>
            {!schema.required?.includes(key) && (
              <label>
                <input
                  type="checkbox"
                  aria-label={`启用 ${path}.${key}`}
                  checked={Object.hasOwn(object, key)}
                  onChange={(e) => {
                    const next = { ...object };
                    if (e.target.checked) next[key] = initial(child);
                    else delete next[key];
                    change(next);
                  }}
                />
                {key}
              </label>
            )}
            {(schema.required?.includes(key) || Object.hasOwn(object, key)) && (
              <Fields
                schema={child}
                value={object[key]}
                path={`${path}.${key}`}
                change={(next) => change({ ...object, [key]: next })}
              />
            )}
          </div>
        ))}
      </fieldset>
    );
  }
  const label = path.split(".").at(-1);
  if (schema.type === "array")
    return (
      <label>
        {label}
        <ArrayField value={value} change={change} label={path} />
      </label>
    );
  return (
    <label>
      {label}
      {schema.enum ? (
        <select
          aria-label={path}
          value={String(value ?? "")}
          onChange={(e) => change(e.target.value)}
        >
          {schema.enum.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      ) : schema.type === "boolean" ? (
        <input
          aria-label={path}
          type="checkbox"
          checked={value === true}
          onChange={(e) => change(e.target.checked)}
        />
      ) : (
        <input
          aria-label={path}
          type={schema.type === "number" ? "number" : "text"}
          min={schema.minimum}
          max={schema.maximum}
          step={schema.integer ? 1 : "any"}
          value={String(value ?? "")}
          onChange={(e) =>
            change(
              schema.type === "number"
                ? Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
    </label>
  );
}
function ArrayField({
  value,
  change,
  label,
}: {
  value: unknown;
  change(value: unknown): void;
  label: string;
}) {
  const [text, setText] = useState(JSON.stringify(value ?? []));
  const [error, setError] = useState(false);
  return (
    <>
      <textarea
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const v: unknown = JSON.parse(e.target.value);
            if (!Array.isArray(v)) throw Error();
            change(v);
            setError(false);
          } catch {
            setError(true);
            change(null);
          }
        }}
      />
      {error && <small role="alert">请输入 JSON 数组。</small>}
    </>
  );
}
export function ResourcePanel({ studio: s }: { studio: Studio }) {
  const [draft, setDraft] = useState<Resource>(),
    [error, setError] = useState("");
  const [kind, setKind] = useState("model");
  const [managedBusy, setManagedBusy] = useState(false);
  const [toolOperationsBusy, setToolOperationsBusy] = useState(false);
  const [operationResourceId, setOperationResourceId] = useState("");
  const panelBusy = managedBusy || toolOperationsBusy;
  const [scope, setScope] = useState<"project" | "user">("project");
  const project = s.snapshot.project;
  const operationResources = s.resources.registry.resources.filter(supportsHostOperation);
  const operationResource = operationResources.find(
    (resource) => resource.resourceId === operationResourceId,
  );
  const definition = resourceDefinitions.find((d) => d.kind === draft?.kind);
  const editableModel =
    draft?.kind === "model" &&
    typeof draft.definition.implementationRef !== "string";
  const editableTool =
    draft?.kind === "tool" && (isPresetTool(draft) || !toolResourceAdapter(draft));
  const editableMcp =
    draft?.kind === "mcp" &&
    (isPresetMcp(draft) || !mcpResourceAdapter(draft));
  const modelError = editableModel ? modelResourceError(draft!) : "";
  const toolSchemaError =
    editableTool && isPresetTool(draft!)
      ? toolResourceSchemaError(draft!, project)
      : "";
  const secretFields = editableModel
    ? [
        ...new Set([
          ...modelSecretFields(draft!),
          ...draft!.secretBindings.map((b) => b.fieldId),
        ]),
      ]
    : editableTool
      ? toolResourceSecretFields(draft!)
      : editableMcp
        ? mcpResourceSecretFields(draft!)
        : (definition?.secretFields ?? []);
  const advancedSchema =
    editableModel && definition
      ? {
          ...definition.definitionSchema,
          properties: Object.fromEntries(
            Object.entries(definition.definitionSchema.properties ?? {}).filter(
              ([key]) => key !== "baseUrl",
            ),
          ),
        }
      : definition?.definitionSchema;
  let knowledgeOptions: RetrievalOptions | undefined;
  let knowledgeChunking:
    | { strategy: string; size: number; overlap: number }
    | undefined;
  let knowledgeError = "";
  const localKnowledge =
    draft?.kind === "knowledge" &&
    typeof draft.definition.implementationRef === "object";
  const collectionId =
    localKnowledge && typeof draft?.definition.collection === "string"
      ? draft.definition.collection
      : draft?.resourceId;
  if (draft?.kind === "knowledge") {
    try {
      knowledgeOptions = resourceRetrieval(draft.definition);
      const value = draft.definition.chunking;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (
          value.strategy !== "paragraph" ||
          typeof value.size !== "number" ||
          typeof value.overlap !== "number" ||
          value.size < 1 ||
          value.size > 16000 ||
          value.overlap < 0 ||
          value.overlap >= value.size
        )
          throw Error();
        knowledgeChunking = {
          strategy: value.strategy,
          size: value.size,
          overlap: value.overlap,
        };
      }
    } catch {
      knowledgeError =
        "当前资料配置不受支持。请在高级配置中使用段落分段及内置检索设置。";
    }
  }
  const edit = (resource: Resource) => {
    if (managedBusy || toolOperationsBusy) return;
    setOperationResourceId("");
    setDraft(structuredClone(resource));
    setError("");
  };
  const save = () => {
    if (managedBusy || toolOperationsBusy) return;
    try {
      if (modelError) {
        setError(modelError);
        return;
      }
      if (toolSchemaError) {
        setError(toolSchemaError);
        return;
      }
      const resource = validateResource(draft);
      if (resource.scope === "user") s.resources.upsert(resource);
      else {
        const next = upsertProjectResource(project, resource);
        s.controller.edit((p) => Object.assign(p, next));
      }
      setDraft(undefined);
      setError("");
    } catch {
      setError("资源字段、公开地址或秘密引用无效，原资源未改变。");
    }
  };
  return (
    <div className="settings resource-panel">
      <label>
        资源范围
        <select
          aria-label="资源范围"
          disabled={panelBusy}
          value={scope}
          onChange={(e) => setScope(e.target.value as "project" | "user")}
        >
          <option value="project">项目</option>
          <option value="user">本机用户</option>
        </select>
      </label>
      {s.resources.error && <p role="alert">{s.resources.error}</p>}
      <div>
        <select
          aria-label="资源类型"
          disabled={panelBusy}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {resourceDefinitions.map((d) => (
            <option key={d.kind} value={d.kind}>
              {d.title}
            </option>
          ))}
        </select>
        <button
          disabled={panelBusy || (scope === "user" && !s.resources.ready)}
          onClick={() => {
            const def = resourceDefinitions.find((d) => d.kind === kind)!;
            edit({
              schemaVersion: "blocky.resource/v1alpha1",
              resourceId: `resource-${crypto.randomUUID()}`,
              kind: def.kind,
              scope,
              displayName: def.title,
              definition: initial(
                def.definitionSchema,
              ) as Resource["definition"],
              secretBindings: [],
              capabilityRequirements: [],
            });
          }}
        >
          新建资源
        </button>
      </div>
      {scope === "user" &&
        s.resources.registry.resources.map((r) => (
          <div key={r.resourceId}>
            <button disabled={panelBusy} onClick={() => edit(r)}>
              {r.displayName} · {r.kind}
            </button>
            <button
              disabled={panelBusy}
              onClick={() => {
                try {
                  const next = referenceUserResource(project, r);
                  s.controller.edit((p) => Object.assign(p, next));
                  s.setMessage("已添加本机资源引用；资源内容不进入项目包。");
                } catch {
                  setError("已有相同 ID 的其他范围资源，无法替换。");
                }
              }}
            >
              引用到当前项目
            </button>
            <button
              disabled={panelBusy}
              onClick={() =>
                void s
                  .confirm("删除本机资源后，引用它的项目将报告资源缺失。继续？")
                  .then((yes) => {
                    if (yes) s.resources.remove(r.resourceId);
                  })
              }
            >
              删除
            </button>
          </div>
        ))}
      {Object.values(project.resources).map((r) => (
        <div key={r.resourceId}>
          <button disabled={panelBusy} onClick={() => edit(r)}>
            {r.displayName} · {r.kind}
          </button>
          <small>
            {analyzeResourceReferences(project, r.resourceId).length} 个引用
          </small>
          <button
            disabled={panelBusy}
            onClick={() =>
              void s
                .confirm("删除资源后，使用它的积木将报告缺失引用。继续？")
                .then((yes) => {
                  if (yes) {
                    const next = removeProjectResource(
                      s.controller.getSnapshot().project,
                      r.resourceId,
                    );
                    s.controller.edit((p) => Object.assign(p, next));
                    if (draft?.resourceId === r.resourceId) setDraft(undefined);
                  }
                })
            }
          >
            删除
          </button>
        </div>
      ))}
      {!draft && operationResources.length > 0 && (
        <>
          <label>
            工具操作资源
            <select
              aria-label="工具操作资源"
              disabled={toolOperationsBusy}
              value={operationResourceId}
              onChange={(event) => setOperationResourceId(event.target.value)}
            >
              <option value="">选择已保存的本机工具或 MCP 服务</option>
              {operationResources.map((resource) => (
                <option key={resource.resourceId} value={resource.resourceId}>
                  {resource.displayName} · {resource.kind}
                </option>
              ))}
            </select>
          </label>
          {operationResource && (
            <ToolOperationsPanel
              key={operationResource.resourceId}
              resource={operationResource}
              projectId={project.manifest.projectId}
              onBusyChange={setToolOperationsBusy}
            />
          )}
        </>
      )}
      {draft && definition && (
        <section key={draft.resourceId}>
          <label>
            名称
            <input
              aria-label="资源名称"
              disabled={managedBusy}
              value={draft.displayName}
              onChange={(e) =>
                setDraft({ ...draft, displayName: e.target.value })
              }
            />
          </label>
          <small>
            {draft.resourceId} ·{" "}
            {draft.scope === "project" ? "项目配置" : "本机用户配置"}
          </small>
          {editableModel && (
            <ModelResourceEditor
              resource={draft}
              change={setDraft}
              onBusyChange={setManagedBusy}
            />
          )}
          {editableTool && (
            <ToolResourceEditor
              resource={draft}
              project={project}
              userResources={s.resources.registry.resources}
              change={setDraft}
            />
          )}
          {editableMcp && <McpResourceEditor resource={draft} change={setDraft} />}
          {typeof draft.definition.implementationRef === "string" ? (
            <p>此资源使用本地确定性适配器。</p>
          ) : !editableTool && !editableMcp ? (
            <details>
              <summary>资源高级配置</summary>
              <fieldset disabled={managedBusy}>
                <Fields
                  schema={advancedSchema!}
                  value={draft.definition}
                  change={(value) =>
                    setDraft({
                      ...draft,
                      definition: value as Resource["definition"],
                    })
                  }
                />
              </fieldset>
            </details>
          ) : null}
          {secretFields.length > 0 && (
            <fieldset disabled={managedBusy}>
              <SecretBindings
                resource={draft}
                fields={secretFields}
                change={(secretBindings) =>
                  setDraft({ ...draft, secretBindings })
                }
              />
            </fieldset>
          )}
          {knowledgeError && <p role="alert">{knowledgeError}</p>}
          {toolSchemaError && <p role="alert">{toolSchemaError}</p>}
          {draft.kind === "knowledge" &&
            draft.scope === "project" &&
            !knowledgeError && (
              <KnowledgePanel
                key={`${project.manifest.projectId}/${draft.resourceId}/${JSON.stringify(draft.definition)}`}
                projectId={project.manifest.projectId}
                collectionId={collectionId!}
                call={knowledgeNative}
                initialOptions={knowledgeOptions}
                chunking={knowledgeChunking}
                onSourcesChanged={s.invalidateKnowledgeEvidence}
                onBind={(configuration) => {
                  const resource = knowledgeResource(
                    draft.resourceId,
                    draft.displayName,
                    configuration,
                  );
                  resource.definition.collection = collectionId!;
                  if (knowledgeChunking)
                    resource.definition.chunking = knowledgeChunking;
                  const next = upsertProjectResource(
                    s.controller.getSnapshot().project,
                    resource,
                  );
                  s.controller.edit((p) => Object.assign(p, next));
                  setDraft(resource);
                  s.setMessage("知识积木已绑定本机资料，请同步后运行。");
                }}
              />
            )}
          {error && <p role="alert">{error}</p>}
          {draft.kind === "memory" && <MemoryPanel key={`${project.manifest.projectId}/${draft.resourceId}`} projectId={project.manifest.projectId}
            retentionDays={Number(draft.definition.retentionDays ?? 0)} sourceRef={typeof draft.definition.sourceRef === "string" ? draft.definition.sourceRef : draft.definition.sourceRef && typeof draft.definition.sourceRef === "object" && !Array.isArray(draft.definition.sourceRef) ? String(draft.definition.sourceRef.id ?? "") : ""}/>} 
          <button onClick={save} disabled={managedBusy || !!modelError || !!toolSchemaError}>
            保存资源
          </button>
          <button disabled={managedBusy} onClick={() => setDraft(undefined)}>
            取消
          </button>
        </section>
      )}
    </div>
  );
}
