import { getBlock } from "@blocky/block-catalog";
import { parseExpressionProgram } from "@blocky/language-schema";
import { codeState } from "@blocky/project-model";
import { useEffect, useState } from "react";
function ProgramInput({ value, save }: { value: unknown; save(text: string): void }) {
  const [text, setText] = useState(JSON.stringify(value ?? null, null, 2));
  useEffect(() => setText(JSON.stringify(value ?? null, null, 2)), [value]);
  let valid = false;
  try { parseExpressionProgram(JSON.parse(text)); valid = true; } catch { /* show draft error */ }
  return (
    <div className="program-editor">
      <textarea aria-label="表达式程序" value={text} onChange={(event) => setText(event.target.value)} />
      {!valid && <small role="alert">无效：表达式结构不符合安全语言，不能运行。</small>}
      <button disabled={!valid || text === JSON.stringify(value ?? null, null, 2)} onClick={() => save(text)}>保存表达式</button>
    </div>
  );
}
function JsonInput({
  value,
  save,
}: {
  value: unknown;
  save(text: string): void;
}) {
  const [text, setText] = useState(JSON.stringify(value ?? null));
  const [error, setError] = useState(false);
  useEffect(() => {
    setText(JSON.stringify(value ?? null));
    setError(false);
  }, [value]);
  return (
    <>
      <textarea
        aria-label="JSON 值"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(false);
        }}
        onBlur={() => {
          try {
            JSON.parse(text);
            save(text);
          } catch {
            setError(true);
          }
        }}
      />
      {error && <small role="alert">JSON 无效，原值保持不变。</small>}
    </>
  );
}
import { findBlock, type Studio } from "../composition/useStudio";
export function Inspector({
  studio: s,
  configureResource,
}: {
  studio: Studio;
  configureResource?: () => void;
}) {
  const block = s.selected
    ? findBlock(
        s.snapshot.project.workspaces[s.session.active]?.blocks.blocks ?? [],
        s.selected,
      )
    : undefined;
  if (!block)
    return (
      <section className="inspector empty-inspector">
        <span className="section-label">积木配置</span>
        <p>选择画布中的积木，查看角色、资源和调用配置。</p>
      </section>
    );
  const def = getBlock(block.type);
  const reference = s.snapshot.project.manifest.resources.find(
    (r) => r.resourceId === block.fields?.RESOURCE,
  );
  const resource = reference
    ? reference.scope === "project"
      ? s.snapshot.project.resources[reference.resourceId]
      : s.resources.map.get(reference.definitionRef)
    : undefined;
  return (
    <section className="inspector">
      <div className="section-label">
        积木配置 <span>{def?.label}</span>
      </div>
      {block.type === "core.data.transform" && (
        <p className={`code-state code-state-${codeState(block)}`} role="status">
          {({ "official-default": "官方默认 ✓", "custom-valid": "已自定义有效 ✓", warning: "警告 ⚠：源码说明不参与执行", invalid: "无效 ✖：不能运行" })[codeState(block)]}
        </p>
      )}
      {(def?.fields ?? []).map((field) => (
        <label key={field}>
          {
            (
              {
                ROLE: "角色与指令",
                NAME: "入口名称",
                MODULE: "目标画布",
                EXPORT: "导出接口",
                INPUT: "输入类型",
                OUTPUT: "输出类型",
                RESOURCE: "资源",
                STYLE: "回答方式",
                MAX_TURNS: "最多轮次",
                OUTPUT_TOKENS: "输出 Token 预算",
                COUNT: "重复次数",
                SOURCE: "取值来源",
                OP: "判断方式",
                VALUE: "比较值",
                MAX_ITEMS: "最多项目数",
                MAX_ITERATIONS: "最多循环次数",
                ATTEMPTS: "最多尝试次数",
                WAIT_MS: "重试等待毫秒",
              } as Record<string, string>
            )[field]
          }
          {block.type === "core.data.transform" && field === "PROGRAM" ? (
            <ProgramInput value={block.fields?.PROGRAM} save={(text) => s.updateField(block.id, field, text)} />
          ) : def?.jsonFields?.includes(field) ? (
            <JsonInput
              value={block.fields?.[field]}
              save={(text) => s.updateField(block.id, field, text)}
            />
          ) : def?.resourceFields?.[field] ? (
            <select
              aria-label="资源"
              value={String(block.fields?.RESOURCE ?? "")}
              onChange={(e) => s.updateField(block.id, field, e.target.value)}
            >
              <option value="">选择资源</option>
              {s.snapshot.project.manifest.resources
                .filter((r) => r.kind === def.resourceFields?.[field])
                .map((r) => (
                  <option key={r.resourceId} value={r.resourceId}>
                    {(r.scope === "project"
                      ? s.snapshot.project.resources[r.resourceId]
                      : s.resources.map.get(r.definitionRef)
                    )?.displayName ?? r.resourceId}{" "}
                    · {r.scope === "project" ? "项目" : "本机"}
                  </option>
                ))}
            </select>
          ) : field === "STYLE" ? (
            <select
              aria-label="回答方式"
              value={String(block.fields?.[field] ?? "条目")}
              onChange={(e) => s.updateField(block.id, field, e.target.value)}
            >
              <option>条目</option>
              <option>段落</option>
            </select>
          ) : field === "ROLE" ? (
            <textarea
              aria-label="角色与指令"
              value={String(block.fields?.[field] ?? "")}
              onChange={(e) => s.updateField(block.id, field, e.target.value)}
            />
          ) : (
            <input
              aria-label={field}
              value={String(block.fields?.[field] ?? "")}
              onChange={(e) => s.updateField(block.id, field, e.target.value)}
            />
          )}
        </label>
      ))}
      {block.type === "core.module.call" && (
        <button
          onClick={() =>
            s.navigate({
              projectId: s.snapshot.project.manifest.projectId,
              moduleId: String(block.fields?.MODULE),
            })
          }
        >
          打开目标画布 ↗
        </button>
      )}
      {resource && (
        <div className="resource-config">
          <div className="section-label">{resource.displayName}</div>
          <small>
            配置来源：{reference?.scope === "user" ? "本机资源" : "项目资源"}
          </small>
          {configureResource && (
            <button onClick={configureResource}>配置资源</button>
          )}
          {resource.kind === "knowledge" && reference?.scope === "project" ? (
            <label>
              资料集合
              <select
                value={String(resource.definition.collection)}
                onChange={(e) =>
                  s.controller.edit((p) => {
                    p.resources[resource.resourceId].definition.collection =
                      e.target.value;
                  })
                }
              >
                <option value="science">自然科学课程</option>
                <option value="blocky">Blocky 使用资料</option>
              </select>
            </label>
          ) : (
            <p>{String(resource.definition.provider ?? resource.kind)}</p>
          )}
          <p className="muted">资源引用：{resource.resourceId}</p>
        </div>
      )}
    </section>
  );
}
