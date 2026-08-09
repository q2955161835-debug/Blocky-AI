import type { InteractionManifest } from "../core/interactionManifest";
import type { RuntimeEvent } from "../core/runtimeEvents";
import type { PendingPermissionRequest } from "../app/useSpikeController";
import { EventTimeline } from "./EventTimeline";
import {
  RuntimeComposer,
  type RuntimeComposerProps,
  type RuntimeInput,
} from "./RuntimeComposer";

export interface RuntimePanelProps {
  manifest: InteractionManifest;
  activeEntryId: string | null;
  onActiveEntryIdChange(entryId: string): void;
  onSubmit(message: RuntimeInput): Promise<void>;
  events: readonly RuntimeEvent[];
  disabled: boolean;
  running: boolean;
  pendingPermission: PendingPermissionRequest | null;
  onCancel(): void;
  onApprovePermission(): void;
  onDenyPermission(): void;
}

export function RuntimePanel({
  manifest,
  activeEntryId,
  onActiveEntryIdChange,
  onSubmit,
  events,
  disabled,
  running,
  pendingPermission,
  onCancel,
  onApprovePermission,
  onDenyPermission,
}: RuntimePanelProps) {
  const composerProps: RuntimeComposerProps = {
    manifest,
    activeEntryId,
    onActiveEntryIdChange,
    onSubmit,
    disabled,
  };

  return (
    <section className="runtime-panel">
      <EventTimeline events={events} />
      {pendingPermission ? (
        <section
          className="runtime-permission"
          role="alertdialog"
          aria-label="工具权限请求"
        >
          <strong>工具权限请求</strong>
          <p>
            Tool：<code>{pendingPermission.toolId}</code>
          </p>
          <p>
            权限：
            {pendingPermission.permissions.length > 0
              ? pendingPermission.permissions.join("、")
              : "无额外权限"}
          </p>
          <div>
            <button type="button" onClick={onDenyPermission}>
              拒绝
            </button>
            <button type="button" onClick={onApprovePermission}>
              批准
            </button>
          </div>
        </section>
      ) : null}
      {running ? (
        <button className="runtime-cancel" type="button" onClick={onCancel}>
          取消运行
        </button>
      ) : null}
      {manifest.entries.length === 0 ? (
        <p className="runtime-panel__empty">添加聊天入口后才能运行作品</p>
      ) : (
        <RuntimeComposer {...composerProps} />
      )}
    </section>
  );
}
