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
import type { Project, Resource } from "@blocky/language-schema";
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
import {SkillPanel} from './SkillPanel';
import {MediaPanel} from './MediaPanel';
import {EvaluationWorkspace} from './EvaluationWorkspace';
import {TriggerPanel} from './TriggerPanel';
import { ModelManagerPanel } from "./ModelManagerPanel";
import { ConnectedModelEditor } from "./ConnectedModelEditor";
import { resolveSetting } from "@blocky/settings-core";
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
  const [saving, setSaving] = useState(false);
  const panelBusy = managedBusy || toolOperationsBusy || saving;
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
  const connectedModel = draft?.kind === "model" && typeof draft.definition.connectionRef === "string";
  const modelError = editableModel && !connectedModel ? modelResourceError(draft!) : "";
  const toolSchemaError =
    editableTool && isPresetTool(draft!)
      ? toolResourceSchemaError(draft!, project)
      : "";
  const secretFields = connectedModel ? [] : editableModel
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
  const persistProjectConfiguration = async (next: Project) => {
    s.controller.edit(p => Object.assign(p, next));
    if ((await s.save()) === false) throw Error("BLK-CONFIG-PERSIST");
  };
  const reference = async (resource: Resource) => {
    if (panelBusy) return;
    setSaving(true);
    try {
      await persistProjectConfiguration(referenceUserResource(s.controller.getSnapshot().project, resource));
      s.setMessage("已保存本机资源引用；资源内容不进入项目包。");
      setError("");
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "BLK-CONFIG-PERSIST"
        ? "配置已更新，但项目文件未保存，请重试保存。"
        : "资源引用无法添加，请检查同名资源。");
    } finally { setSaving(false); }
  };
  const save = async () => {
    if (panelBusy) return;
    if (panelBusy) return;
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
      setSaving(true);
      if (resource.scope === "user") await s.resources.upsert(resource);
      else {
        const next = upsertProjectResource(project, resource);
        await persistProjectConfiguration(next);
      }
      setDraft(undefined);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "BLK-CONFIG-PERSIST"
        ? "配置已更新，但项目文件未保存；草稿保留，请重试保存。"
        : "资源未保存，请检查字段、秘密引用或并发修改；原资源与草稿保留。");
    } finally { setSaving(false); }
  };
  return (
    <div className="settings resource-panel">
      <details><summary>厂商与模型</summary><ModelManagerPanel resources={s.resources}
        defaultModelId={s.settings ? String(resolveSetting("models.defaultResourceId",s.settings.layers).value) : ""}
        setDefault={async id=>{s.settings.change("app","models.defaultResourceId",id);await s.settings.flush();}}
        reference={resource => { void reference(resource); }}/></details>
      <details><summary>项目媒体</summary><MediaPanel key={project.manifest.projectId} projectId={project.manifest.projectId}/></details>
      <details><summary>评估工作台</summary><EvaluationWorkspace key={project.manifest.projectId} studio={s}/></details>
      <details><summary>项目触发器</summary><TriggerPanel key={project.manifest.projectId} studio={s}/></details>
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
              onClick={() => { void reference(r); }}
            >
              引用到当前项目
            </button>
            <button
              disabled={panelBusy}
              onClick={() =>
                void s
                  .confirm("删除本机资源后，引用它的项目将报告资源缺失。继续？")
                  .then((yes) => {
                    if (yes) return s.resources.remove(r.resourceId);
                  })
                  .catch(() => setError("资源未删除，原配置保留。"))
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
                .then(async (yes) => {
                  if (yes) {
                    const next = removeProjectResource(
                      s.controller.getSnapshot().project,
                      r.resourceId,
                    );
                    await persistProjectConfiguration(next);
                    if (draft?.resourceId === r.resourceId) setDraft(undefined);
                  }
                }).catch(() => setError("配置删除未完成或项目文件未保存，请检查当前项目。"))
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
          {connectedModel && <ConnectedModelEditor resource={draft} providers={s.resources.registry.providers} change={setDraft}/>}
          {editableModel && !connectedModel && (
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
          ) : !editableTool && !editableMcp && !connectedModel ? (
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
                  setDraft(resource);
                  setSaving(true);
                  void persistProjectConfiguration(next).then(() => {
                    s.setMessage("知识积木已保存资料配置，请同步后运行。");
                  }).catch(() => setError("资料配置已更新，但项目文件未保存，请重试保存。"))
                    .finally(() => setSaving(false));
                }}
              />
            )}
          {error && <p role="alert">{error}</p>}
          {draft.kind==='skill'&&<SkillPanel key={`${project.manifest.projectId}/${draft.resourceId}`} projectId={project.manifest.projectId} onBind={skill=>setDraft({...draft,definition:{...draft.definition,version:skill.metadata.version,sourceRef:{kind:'artifact',id:skill.metadata.skillId},contentDigest:skill.digest,implementationRef:{kind:'adapter',id:'installed-skill-v1'},permissions:[]}})}/>}
          {draft.kind === "memory" && <MemoryPanel key={`${project.manifest.projectId}/${draft.resourceId}`} projectId={project.manifest.projectId}
            retentionDays={Number(draft.definition.retentionDays ?? 0)} sourceRef={typeof draft.definition.sourceRef === "string" ? draft.definition.sourceRef : draft.definition.sourceRef && typeof draft.definition.sourceRef === "object" && !Array.isArray(draft.definition.sourceRef) ? String(draft.definition.sourceRef.id ?? "") : ""}/>} 
          <button onClick={save} disabled={panelBusy || !!modelError || !!toolSchemaError}>
            保存资源
          </button>
          <button disabled={panelBusy} onClick={() => setDraft(undefined)}>
            取消
          </button>
        </section>
      )}
    </div>
  );
}
