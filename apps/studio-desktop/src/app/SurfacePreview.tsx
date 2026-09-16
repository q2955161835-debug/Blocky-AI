import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { encodeProject } from "@blocky/project-format";
import {
  surfaceFromProject,
  previewDocument,
  previewSandbox,
  createBridge,
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
    dispose = useRef<() => void>(() => {});
  const current = useRef(studio);
  current.current = studio;
  const [ready, setReady] = useState(false),
    [error, setError] = useState(false);
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
  }, [draft, surfaceId]);
  const connect = () => {
    dispose.current();
    if (!frame.current?.contentWindow || !draft) return;
    const channel = new MessageChannel();
    const bridge = createBridge(
      async (question, signal) => {
        const s = current.current;
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
        if (signal.aborted) return;
        const result = await s.run({
          question,
          moduleId,
          interactionId: entries[0].interactionId,
          signal,
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
      {error ? (
        <p role="alert">应用界面未能打开，请检查项目或窗口状态。</p>
      ) : ready && draft ? (
        <iframe
          ref={frame}
          title={draft.manifest.displayName}
          sandbox={previewSandbox}
          srcDoc={previewDocument(draft)}
          onLoad={connect}
          referrerPolicy="no-referrer"
        />
      ) : (
        <p>正在打开应用界面…</p>
      )}
    </div>
  );
}
