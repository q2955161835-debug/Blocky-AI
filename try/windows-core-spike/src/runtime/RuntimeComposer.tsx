import { Send20Filled } from "@fluentui/react-icons";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import type {
  InputPartKind,
  InteractionManifest,
} from "../core/interactionManifest";

export interface DraftAttachment {
  id: string;
  kind: "image" | "file" | "voice";
  name: string;
  bytes: number;
}

export interface RuntimeInput {
  entryId: string;
  text?: string;
  attachments: DraftAttachment[];
  exposedSkillId?: string;
  exposedPluginActionId?: string;
}

export interface RuntimeComposerProps {
  manifest: InteractionManifest;
  activeEntryId: string | null;
  onActiveEntryIdChange(entryId: string): void;
  onSubmit(message: RuntimeInput): Promise<unknown>;
  disabled: boolean;
}

interface EntryDraft {
  text: string;
  attachments: DraftAttachment[];
  exposedSkillId: string;
  exposedPluginActionId: string;
}

const EMPTY_DRAFT: EntryDraft = {
  text: "",
  attachments: [],
  exposedSkillId: "",
  exposedPluginActionId: "",
};

const attachmentMetadata: Record<
  DraftAttachment["kind"],
  { accept?: string; label: string; testId: string }
> = {
  image: { accept: "image/*", label: "图片", testId: "runtime-add-image" },
  file: { label: "文件", testId: "runtime-add-file" },
  voice: { accept: "audio/*", label: "语音", testId: "runtime-add-voice" },
};

export function RuntimeComposer({
  manifest,
  activeEntryId,
  onActiveEntryIdChange,
  onSubmit,
  disabled,
}: RuntimeComposerProps) {
  const labelId = useId();
  const attachmentSequence = useRef(0);
  const [drafts, setDrafts] = useState<Record<string, EntryDraft>>({});
  const activeEntry = useMemo(
    () => manifest.entries.find((entry) => entry.id === activeEntryId) ?? null,
    [activeEntryId, manifest.entries],
  );
  const draft = activeEntryId ? drafts[activeEntryId] ?? EMPTY_DRAFT : EMPTY_DRAFT;

  if (!activeEntry || !activeEntryId) return null;

  const updateDraft = (update: (current: EntryDraft) => EntryDraft): void => {
    setDrafts((current) => ({
      ...current,
      [activeEntryId]: update(current[activeEntryId] ?? EMPTY_DRAFT),
    }));
  };

  const addAttachment = (
    kind: DraftAttachment["kind"],
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    attachmentSequence.current += 1;
    const attachment: DraftAttachment = {
      id: `${activeEntryId}-${kind}-${attachmentSequence.current}`,
      kind,
      name: file.name,
      bytes: file.size,
    };
    updateDraft((current) => ({
      ...current,
      attachments: [...current.attachments, attachment],
    }));
    event.currentTarget.value = "";
  };

  const accepted = new Set<InputPartKind>(activeEntry.acceptedParts);
  const unsupportedAttachments = draft.attachments.filter(
    (attachment) => !accepted.has(attachment.kind),
  );
  const supportedAttachments = draft.attachments.filter((attachment) =>
    accepted.has(attachment.kind),
  );
  const supportedText = accepted.has("text") ? draft.text : "";
  const supportedSkillId = activeEntry.exposedSkills.includes(
    draft.exposedSkillId,
  )
    ? draft.exposedSkillId
    : "";
  const supportedPluginActionId = activeEntry.exposedPluginActions.includes(
    draft.exposedPluginActionId,
  )
    ? draft.exposedPluginActionId
    : "";
  const canSubmit =
    !disabled &&
    unsupportedAttachments.length === 0 &&
    (supportedText.trim().length > 0 ||
      supportedAttachments.length > 0 ||
      supportedSkillId.length > 0 ||
      supportedPluginActionId.length > 0);

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    const message: RuntimeInput = {
      entryId: activeEntryId,
      ...(supportedText.trim() ? { text: supportedText } : {}),
      attachments: [...supportedAttachments],
      ...(supportedSkillId ? { exposedSkillId: supportedSkillId } : {}),
      ...(supportedPluginActionId
        ? { exposedPluginActionId: supportedPluginActionId }
        : {}),
    };
    try {
      await onSubmit(message);
      setDrafts((current) => ({ ...current, [activeEntryId]: EMPTY_DRAFT }));
    } catch {
      // Keep the draft for an explicit retry; the controller owns visible errors.
    }
  };

  return (
    <section className="runtime-composer" aria-labelledby={labelId}>
      <div className="runtime-composer__header">
        <h2 id={labelId}>输入</h2>
        <label className="runtime-composer__entry">
          <span className="sr-only">选择入口</span>
          <select
            data-testid="runtime-entry-select"
            value={activeEntryId}
            onChange={(event) => onActiveEntryIdChange(event.currentTarget.value)}
            disabled={disabled}
          >
            {manifest.entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>

      {accepted.has("text") ? (
        <textarea
          data-testid="runtime-text-input"
          aria-label="发送给 Agent"
          placeholder="发送给 Agent"
          value={draft.text}
          onChange={(event) => {
            const text = event.currentTarget.value;
            updateDraft((current) => ({ ...current, text }));
          }}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
              return;
            }
            event.preventDefault();
            void submit();
          }}
          disabled={disabled}
          rows={3}
        />
      ) : null}

      {draft.attachments.length > 0 ? (
        <ul className="runtime-composer__attachments" aria-label="附件草稿">
          {draft.attachments.map((attachment) => (
            <li key={attachment.id}>
              <span>{attachment.name}</span>
              <button
                type="button"
                aria-label={`删除 ${attachment.name}`}
                onClick={() =>
                  updateDraft((current) => ({
                    ...current,
                    attachments: current.attachments.filter(
                      (candidate) => candidate.id !== attachment.id,
                    ),
                  }))
                }
                disabled={disabled}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {unsupportedAttachments.length > 0 ? (
        <p className="runtime-composer__warning" role="status">
          当前入口已不接受该附件，请删除或切回支持它的入口
        </p>
      ) : null}

      <div className="runtime-composer__capabilities">
        {(["image", "file", "voice"] as const).map((kind) => {
          if (!accepted.has(kind)) return null;
          const metadata = attachmentMetadata[kind];
          return (
            <label key={kind} className="runtime-composer__file-control">
              <input
                data-testid={metadata.testId}
                aria-label={metadata.label}
                type="file"
                accept={metadata.accept}
                onChange={(event) => addAttachment(kind, event)}
                disabled={disabled}
              />
              <span>{metadata.label}</span>
            </label>
          );
        })}

        {activeEntry.exposedSkills.length > 0 ? (
          <label className="runtime-composer__menu">
            <span className="sr-only">Skill</span>
            <select
              data-testid="runtime-skill-menu"
              value={draft.exposedSkillId}
              onChange={(event) => {
                const exposedSkillId = event.currentTarget.value;
                updateDraft((current) => ({ ...current, exposedSkillId }));
              }}
              disabled={disabled}
            >
              <option value="">Skill</option>
              {activeEntry.exposedSkills.map((skillId) => (
                <option key={skillId} value={skillId}>
                  {skillId}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {activeEntry.exposedPluginActions.length > 0 ? (
          <label className="runtime-composer__menu">
            <span className="sr-only">插件</span>
            <select
              data-testid="runtime-plugin-menu"
              value={draft.exposedPluginActionId}
              onChange={(event) => {
                const exposedPluginActionId = event.currentTarget.value;
                updateDraft((current) => ({
                  ...current,
                  exposedPluginActionId,
                }));
              }}
              disabled={disabled}
            >
              <option value="">插件</option>
              {activeEntry.exposedPluginActions.map((actionId) => (
                <option key={actionId} value={actionId}>
                  {actionId}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <button
        className="runtime-composer__send"
        data-testid="runtime-send"
        type="button"
        aria-label="发送消息"
        onClick={() => void submit()}
        disabled={!canSubmit}
      >
        <Send20Filled aria-hidden="true" />
      </button>
    </section>
  );
}
