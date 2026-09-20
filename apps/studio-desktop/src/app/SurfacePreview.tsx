import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { encodeProject } from "@blocky/project-format";
import {
  surfaceFromProject,
  previewSandbox,
  createBridge,
  parseSurfaceSpec,
  buildSurface,
} from "@blocky/app-surface";
import type { Studio } from "../composition/useStudio";
export function SurfacePreview({
  studio,
  surfaceId,
  hidden,
}: {
  studio: Studio;
  surfaceId: string;
  hidden: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null),
    viewportHost = useRef<HTMLDivElement>(null),
    dispose = useRef<() => void>(() => {});
  const current = useRef(studio);
  current.current = studio;
  const [ready, setReady] = useState(false),
    [error, setError] = useState(false);
  const [enabled, setEnabled] = useState(true),
    [revision, setRevision] = useState(0),
    [viewport, setViewport] = useState("desktop");
  const [size, setSize] = useState({ width: 600, height: 500 });
  useEffect(() => {
    const node = viewportHost.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((old) =>
        old.width === width && old.height === height ? old : { width, height },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ready]);
  const viewportWidth =
    viewport === "mobile" ? 390 : viewport === "tablet" ? 768 : 1280;
  const scale = Math.min(1, Math.max(1, size.width) / viewportWidth);
  const draft = useMemo(() => {
    try {
      return surfaceFromProject(studio.snapshot.project, surfaceId);
    } catch {
      return undefined;
    }
  }, [studio.snapshot.project, surfaceId]);
  useEffect(() => {
    let active = true;
    setReady(false);
    setError(false);
    dispose.current();
    if (!draft) {
      setError(true);
      return;
    }
    if (!enabled) return;
    void invoke("authorize_surface", {
      files: encodeProject(studio.snapshot.project),
      surfaceId,
    })
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      dispose.current();
    };
  }, [draft, surfaceId, enabled, revision]);
  const connect = () => {
    dispose.current();
    if (!frame.current?.contentWindow || !draft) return;
    const connectedProject = studio.snapshot.project;
    const channel = new MessageChannel();
    const bridge = createBridge(
      async (question, signal, progress) => {
        const s = current.current;
        if (s.controller.getSnapshot().project !== connectedProject)
          throw Error("BLK-SURFACE-002");
        const surface = surfaceFromProject(
          s.controller.getSnapshot().project,
          surfaceId,
        );
        const moduleId = surface.manifest.associatedModuleIds[0];
        const entries =
          s.compiled?.interaction.entries.filter(
            (e) => e.moduleId === moduleId,
          ) ?? [];
        if (entries.length !== 1) throw Error("BLK-SURFACE-002");
        await invoke("authorize_surface", {
          files: encodeProject(s.controller.getSnapshot().project),
          surfaceId,
        });
        if (
          signal.aborted ||
          current.current.controller.getSnapshot().project !== connectedProject
        )
          return;
        const result = await s.run({
          question,
          moduleId,
          interactionId: entries[0].interactionId,
          signal,
          onProgress: progress,
        });
        return result
          ? {
              status: result.status,
              answer: result.answer,
              citations: result.citations.map((c) => ({
                title: c.title,
                locator: c.id,
              })),
            }
          : undefined;
      },
      (reply) => channel.port1.postMessage(reply),
      {
        spec:
          draft.manifest.schemaVersion === "blocky.app-surface/v1"
            ? parseSurfaceSpec(
                draft.files[`surfaces/${surfaceId}/surface-spec.json`],
              )
            : undefined,
        confirm: async (signal) => {
          const s = current.current;
          if (s.controller.getSnapshot().project !== connectedProject)
            return false;
          const cancel = () => s.answerConfirmation(false);
          signal.addEventListener("abort", cancel, { once: true });
          try {
            if (signal.aborted) return false;
            return await s.confirm(
              `允许“${draft.manifest.displayName}”提交本次表单并运行关联智能体？`,
              {
                title: "运行应用页面",
                acceptLabel: "允许本次运行",
                rejectLabel: "取消",
              },
            );
          } finally {
            signal.removeEventListener("abort", cancel);
          }
        },
      },
    );
    channel.port1.onmessage = (e) => void bridge.receive(e.data);
    channel.port1.start();
    dispose.current = () => {
      bridge.close();
      channel.port1.close();
      channel.port2.close();
    };
    frame.current.contentWindow.postMessage(
      { kind: "blocky.bridge.init" },
      "*",
      [channel.port2],
    );
  };
  return (
    <div className="surface-preview" hidden={hidden}>
      <div className="surface-toolbar" aria-label="应用界面预览控制">
        <button onClick={() => setEnabled((v) => !v)}>
          {enabled ? "停止预览" : "启动预览"}
        </button>
        <button
          disabled={!enabled}
          onClick={() => {
            dispose.current();
            setReady(false);
            setRevision((v) => v + 1);
          }}
        >
          刷新
        </button>
        <button
          disabled={!draft}
          onClick={() =>
            studio.navigate({
              projectId: studio.snapshot.project.manifest.projectId,
              moduleId: draft?.manifest.associatedModuleIds[0],
            })
          }
        >
          返回画布
        </button>
        <label>
          视口
          <select
            aria-label="预览视口"
            value={viewport}
            onChange={(e) => setViewport(e.target.value)}
          >
            <option value="desktop">桌面</option>
            <option value="tablet">平板</option>
            <option value="mobile">手机</option>
          </select>
        </label>
        <span role="status">
          {!enabled
            ? "已停止"
            : error
              ? "预览失败"
              : ready
                ? "预览已启动"
                : "启动中"}
        </span>
      </div>
      {!enabled ? (
        <p>预览已停止，页面源码仍保留在项目中。</p>
      ) : error ? (
        <p role="alert">应用界面未能打开，请检查项目或窗口状态。</p>
      ) : ready && draft ? (
        <div ref={viewportHost} className="surface-viewport">
          <iframe
            key={revision}
            ref={frame}
            title={draft.manifest.displayName}
            sandbox={previewSandbox}
            srcDoc={buildSurface(studio.snapshot.project, surfaceId).html}
            onLoad={connect}
            referrerPolicy="no-referrer"
            style={{
              width: viewportWidth,
              height: Math.max(1, size.height) / scale,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              left: Math.max(0, (size.width - viewportWidth * scale) / 2),
            }}
          />
        </div>
      ) : (
        <p>正在打开应用界面…</p>
      )}
    </div>
  );
}
