import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { walkBlocks } from "@blocky/block-catalog";
import {
  codingChangeSchema,
  codingChangesSchema,
  type CodingChange,
} from "@blocky/builder-protocol";
import { inspectRunSetup, type SetupIssue } from "@blocky/runtime-core";
import type { Project, Resource } from "@blocky/language-schema";
import type { Studio } from "../composition/useStudio";
import { knowledgeNative } from "../composition/knowledge";

type WorkspaceStatus = {
  available: boolean;
  workspaceId: string | null;
  displayName: string | null;
  changes: CodingChange[];
};
type WorkspaceChangeView = { change: CodingChange; undone: boolean };

type SetupResult = Awaited<ReturnType<typeof inspectRunSetup>>;

function parseWorkspaceStatus(value: unknown): WorkspaceStatus {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("BLK-CODING-STATE");
  const status = value as Record<string, unknown>;
  const available = status.available === true;
  const workspaceId = typeof status.workspaceId === "string" ? status.workspaceId : null;
  if (available && !workspaceId) throw Error("BLK-CODING-STATE");
  return {
    available,
    workspaceId,
    displayName: typeof status.displayName === "string" ? status.displayName : null,
    changes: codingChangesSchema.parse(status.changes),
  };
}

function workspaceChangeViews(changes: CodingChange[]): WorkspaceChangeView[] {
  const views: WorkspaceChangeView[] = [];
  for (const change of changes) {
    if (!change.revertsChangeId) {
      if (changes.some((candidate) => candidate.revertsChangeId === change.changeId))
        continue;
      views.push({ change, undone: false });
      continue;
    }
    const original = codingChangeSchema.parse({
      changeId: change.revertsChangeId,
      path: change.path,
      before: change.after,
      after: change.before,
      beforeDigest: change.afterDigest,
      afterDigest: change.beforeDigest,
    });
    views.push({ change: original, undone: true });
  }
  return views;
}

function setupKey(project: Project, registryRevision: number): string {
  const relevantTypes = new Set([
    "core.model.compose",
    "core.reason.tool_loop",
    "core.knowledge.correct",
    "core.knowledge.retrieve",
    "core.knowledge.sync",
    "core.tool.expose",
    "core.tool.call",
  ]);
  const blocks = Object.entries(project.workspaces).flatMap(([moduleId, workspace]) =>
    [...walkBlocks(workspace.blocks.blocks)]
      .filter((block) => relevantTypes.has(block.type))
      .map((block) => [moduleId, block.type, block.id, block.fields]),
  );
  const projectResources = Object.values(project.resources).map((resource) => [
    resource.resourceId,
    resource.kind,
    resource.definition,
    resource.secretBindings,
  ]);
  return JSON.stringify([
    project.manifest.projectId,
    registryRevision,
    project.manifest.resources,
    projectResources,
    blocks,
  ]);
}

async function inspectCurrentProject(
  projectId: string,
  project: Project,
  registry: Map<string, Resource>,
): Promise<{
  setup: SetupResult;
  workspace?: WorkspaceStatus;
  workspaceError?: string;
}> {
  let workspace: WorkspaceStatus | undefined;
  let workspaceError: string | undefined;
  if (isTauri()) {
    try {
      workspace = parseWorkspaceStatus(
        await invoke<unknown>("workspace_status", { projectId }),
      );
    } catch {
      workspaceError = "工作目录状态暂不可读取，可重试检查。";
    }
  }
  const setup = await inspectRunSetup(project, {
    registry,
    ...(workspace ? { workspaceAvailable: workspace.available } : {}),
    knowledgeCall: knowledgeNative,
  });
  return { setup, workspace, workspaceError };
}

function issueTitle(issue: SetupIssue): string {
  if (issue.kind === "model") return "模型配置";
  if (issue.kind === "knowledge") return "资料配置";
  if (issue.kind === "workspace") return "工作目录";
  return "项目检查";
}

export function StartingConfiguration({
  studio: s,
  execute,
}: {
  studio: Studio;
  execute(id: string): void;
}) {
  const project = s.snapshot.project;
  const projectId = project.manifest.projectId;
  const registry = s.resources.map;
  const key = setupKey(project, s.resources.registry.revision);
  const [setup, setSetup] = useState<SetupResult>();
  const [workspace, setWorkspace] = useState<WorkspaceStatus>();
  const [workspaceError, setWorkspaceError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const ownerKey = useRef(key);
  const requestSequence = useRef(0);
  ownerKey.current = key;

  useEffect(() => {
    const request = ++requestSequence.current;
    const requestKey = key;
    setBusy(true);
    setSetup(undefined);
    setWorkspace(undefined);
    setWorkspaceError("");
    setError("");
    void inspectCurrentProject(projectId, project, registry)
      .then((result) => {
        if (ownerKey.current !== requestKey || requestSequence.current !== request) return;
        setSetup(result.setup);
        setWorkspace(result.workspace);
        setWorkspaceError(result.workspaceError ?? "");
      })
      .catch(() => {
        if (ownerKey.current === requestKey && requestSequence.current === request)
          setError("运行配置状态暂不可读取，请重试检查。");
      })
      .finally(() => {
        if (ownerKey.current === requestKey && requestSequence.current === request)
          setBusy(false);
      });
    return () => {
      if (requestSequence.current === request) requestSequence.current++;
    };
  }, [key, s.result]);

  const refresh = async () => {
    const requestKey = key;
    const request = ++requestSequence.current;
    setBusy(true);
    setError("");
    try {
      const result = await inspectCurrentProject(projectId, project, registry);
      if (ownerKey.current !== requestKey || requestSequence.current !== request) return;
      setSetup(result.setup);
      setWorkspace(result.workspace);
      setWorkspaceError(result.workspaceError ?? "");
    } catch {
      if (ownerKey.current === requestKey && requestSequence.current === request)
        setError("运行配置状态暂不可读取，请重试检查。");
    } finally {
      if (ownerKey.current === requestKey && requestSequence.current === request)
        setBusy(false);
    }
  };

  const pickWorkspace = async () => {
    if (!isTauri() || busy) return;
    const requestKey = key;
    const request = ++requestSequence.current;
    setBusy(true);
    setError("");
    setWorkspaceError("");
    try {
      const selected = await invoke<unknown>("coding_workspace_pick", {
        projectId,
      });
      if (ownerKey.current !== requestKey || requestSequence.current !== request) return;
      if (selected !== null && selected !== undefined) {
        const result = await inspectCurrentProject(projectId, project, registry);
        if (ownerKey.current !== requestKey || requestSequence.current !== request) return;
        setSetup(result.setup);
        setWorkspace(result.workspace);
        setWorkspaceError(result.workspaceError ?? "");
      }
    } catch {
      if (ownerKey.current === requestKey && requestSequence.current === request)
        setWorkspaceError("工作目录未更改，请重试选择。");
    } finally {
      if (ownerKey.current === requestKey && requestSequence.current === request)
        setBusy(false);
    }
  };

  const undoWorkspaceChange = async (changeId: string) => {
    if (!isTauri() || busy || !workspace?.workspaceId) return;
    const receipt = workspace.changes.find((change) => change.changeId === changeId);
    if (!receipt || receipt.revertsChangeId) return;
    const requestKey = key;
    const request = ++requestSequence.current;
    const workspaceId = workspace.workspaceId;
    setBusy(true);
    setError("");
    setWorkspaceError("");
    try {
      const reversed = codingChangeSchema.parse(
        await invoke<unknown>("coding_undo", { workspaceId, changeId }),
      );
      if (
        reversed.revertsChangeId !== changeId ||
        reversed.path !== receipt.path ||
        reversed.before !== receipt.after ||
        reversed.after !== receipt.before ||
        reversed.beforeDigest !== receipt.afterDigest ||
        reversed.afterDigest !== receipt.beforeDigest
      )
        throw Error("BLK-CODING-CHANGE");
      if (ownerKey.current !== requestKey || requestSequence.current !== request) return;
      const result = await inspectCurrentProject(projectId, project, registry);
      if (ownerKey.current !== requestKey || requestSequence.current !== request) return;
      setSetup(result.setup);
      setWorkspace(result.workspace);
      setWorkspaceError(result.workspaceError ?? "");
    } catch {
      if (ownerKey.current === requestKey && requestSequence.current === request)
        setWorkspaceError("文件撤回未完成，工作目录状态未更新，请重新检查。");
    } finally {
      if (ownerKey.current === requestKey && requestSequence.current === request)
        setBusy(false);
    }
  };

  if (!setup && !busy && !error) return null;
  const issues = setup?.issues ?? [];
  const changeViews = workspaceChangeViews(workspace?.changes ?? []);
  const shouldShow = !!setup &&
    (issues.length > 0 || setup.needsWorkspace || setup.knowledge.length > 0);
  if (!shouldShow && !busy && !error && !workspaceError) return null;

  return (
    <section
      className="run-setup"
      aria-label="运行配置状态"
      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong>运行配置</strong>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          刷新状态
        </button>
      </div>
      {busy && <p role="status">正在检查模型、资料和工作目录…</p>}
      {error && <p role="alert">{error}</p>}
      {workspaceError && <p role="alert">{workspaceError}</p>}
      {setup?.needsWorkspace && !isTauri() && (
        <p>此工具需要在 Blocky Studio 桌面端选择工作目录。</p>
      )}
      {setup?.needsWorkspace && workspace?.available && (
        <p role="status">
          工作目录已选择：{workspace.displayName ?? "已选目录"} · {workspace.changes.length} 条变更记录
          <button type="button" disabled={busy} onClick={() => void pickWorkspace()}>
            更换目录
          </button>
        </p>
      )}
      {setup?.needsWorkspace && workspace?.available && changeViews.length > 0 && (
        <section className="coding-changes" aria-label="工作目录文件修改">
          <header>
            <strong>工作目录文件修改</strong>
            <span>{changeViews.filter((item) => !item.undone).length} 个可撤销变更</span>
          </header>
          {changeViews.map(({ change, undone }) => (
            <div className="coding-change" key={change.changeId}>
              <div className="coding-change-heading">
                <span title={change.path}>{change.path}</span>
                {undone ? (
                  <span role="status">已撤回</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`撤回 ${change.path}`}
                    onClick={() => void undoWorkspaceChange(change.changeId)}
                  >
                    撤回
                  </button>
                )}
              </div>
              <details>
                <summary>查看差异</summary>
                <div style={{ display: "grid", gap: 8, overflow: "auto" }}>
                  <div>
                    <span>修改前</span>
                    <pre>{change.before ?? "（新文件）"}</pre>
                  </div>
                  <div>
                    <span>修改后</span>
                    <pre>{change.after ?? "（已删除）"}</pre>
                  </div>
                </div>
              </details>
            </div>
          ))}
        </section>
      )}
      {setup?.knowledge.map((item) =>
        item.state === "ready" ? (
          <p key={item.resourceId} role="status">
            资料已同步：{item.chunks} 个片段可供检索。
          </p>
        ) : null,
      )}
      {issues.map((issue) => (
        <div
          key={`${issue.kind}:${issue.resourceId ?? ""}:${issue.code}`}
          style={{ display: "grid", gap: 4, marginTop: 8 }}
        >
          <strong>{issueTitle(issue)}</strong>
          <span>{issue.message}</span>
          {issue.kind === "model" && (
            <button type="button" onClick={() => execute("settings.resources")}>
              配置模型
            </button>
          )}
          {issue.kind === "knowledge" && (
            <button type="button" onClick={() => execute("settings.resources")}>
              添加并同步资料
            </button>
          )}
          {issue.kind === "workspace" && isTauri() && (
            <button type="button" disabled={busy} onClick={() => void pickWorkspace()}>
              选择工作目录
            </button>
          )}
          {issue.kind === "project" && (
            <button type="button" onClick={() => execute("view.show-problems")}>
              查看项目问题
            </button>
          )}
        </div>
      ))}
      {setup && issues.length === 0 && setup.ready && (
        <p role="status">运行配置已就绪。</p>
      )}
    </section>
  );
}
