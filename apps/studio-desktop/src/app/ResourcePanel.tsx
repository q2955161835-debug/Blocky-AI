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
import { KnowledgePanel } from "./KnowledgePanel";
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
  const [scope, setScope] = useState<"project" | "user">("project");
  const project = s.snapshot.project;
  const definition = resourceDefinitions.find((d) => d.kind === draft?.kind);
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
    setDraft(structuredClone(resource));
    setError("");
  };
  const save = () => {
    try {
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
          disabled={scope === "user" && !s.resources.ready}
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
            <button onClick={() => edit(r)}>
              {r.displayName} · {r.kind}
            </button>
            <button
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
          <button onClick={() => edit(r)}>
            {r.displayName} · {r.kind}
          </button>
          <small>
            {analyzeResourceReferences(project, r.resourceId).length} 个引用
          </small>
          <button
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
      {draft && definition && (
        <section key={draft.resourceId}>
          <label>
            名称
            <input
              aria-label="资源名称"
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
          {typeof draft.definition.implementationRef === "string" ? (
            <p>此资源使用本地确定性适配器。</p>
          ) : (
            <details>
              <summary>资源高级配置</summary>
              <Fields
                schema={definition.definitionSchema}
                value={draft.definition}
                change={(value) =>
                  setDraft({
                    ...draft,
                    definition: value as Resource["definition"],
                  })
                }
              />
            </details>
          )}
          <SecretBindings
            resource={draft}
            fields={definition.secretFields}
            change={(secretBindings) => setDraft({ ...draft, secretBindings })}
          />
          {knowledgeError && <p role="alert">{knowledgeError}</p>}
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
          <button onClick={save}>保存资源</button>
          <button onClick={() => setDraft(undefined)}>取消</button>
        </section>
      )}
    </div>
  );
}
