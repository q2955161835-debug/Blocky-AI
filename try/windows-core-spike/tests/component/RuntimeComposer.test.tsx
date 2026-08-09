import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  InteractionEntry,
  InteractionManifest,
} from "../../src/core/interactionManifest";
import { RuntimeComposer } from "../../src/runtime/RuntimeComposer";

function entry(
  id: string,
  displayName: string,
  options: Pick<
    InteractionEntry,
    "acceptedParts" | "exposedSkills" | "exposedPluginActions"
  >,
): InteractionEntry {
  return {
    id,
    displayName,
    ownerAgentId: "agent-1",
    executionRequirements: [],
    ...options,
  };
}

function manifest(entries: readonly InteractionEntry[]): InteractionManifest {
  return {
    schemaVersion: "blocky.interaction/v0-spike",
    entries,
  };
}

const ENTRY_A = entry("entry-a", "输入 1", {
  acceptedParts: ["text", "image"],
  exposedSkills: [],
  exposedPluginActions: [],
});

const ENTRY_B = entry("entry-b", "文件处理", {
  acceptedParts: ["text", "file", "voice"],
  exposedSkills: ["skill.document"],
  exposedPluginActions: ["plugin.archive"],
});

describe("RuntimeComposer", () => {
  it("derives all six capability controls only from the active manifest entry", async () => {
    const user = userEvent.setup();
    const onActiveEntryIdChange = vi.fn();
    const { rerender } = render(
      <RuntimeComposer
        manifest={manifest([ENTRY_A, ENTRY_B])}
        activeEntryId="entry-a"
        onActiveEntryIdChange={onActiveEntryIdChange}
        onSubmit={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByTestId("runtime-text-input")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-add-image")).toBeInTheDocument();
    expect(screen.queryByTestId("runtime-add-file")).not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-add-voice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-skill-menu")).not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-plugin-menu")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByTestId("runtime-entry-select"), "entry-b");
    expect(onActiveEntryIdChange).toHaveBeenCalledWith("entry-b");
    rerender(
      <RuntimeComposer
        manifest={manifest([ENTRY_A, ENTRY_B])}
        activeEntryId="entry-b"
        onActiveEntryIdChange={onActiveEntryIdChange}
        onSubmit={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByTestId("runtime-text-input")).toBeInTheDocument();
    expect(screen.queryByTestId("runtime-add-image")).not.toBeInTheDocument();
    expect(screen.getByTestId("runtime-add-file")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-add-voice")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-skill-menu")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-plugin-menu")).toBeInTheDocument();
  });

  it("keeps independent text drafts by stable entry ID across renamed entry switching", async () => {
    const user = userEvent.setup();
    const onActiveEntryIdChange = vi.fn();
    const view = render(
      <RuntimeComposer
        manifest={manifest([ENTRY_A, ENTRY_B])}
        activeEntryId="entry-a"
        onActiveEntryIdChange={onActiveEntryIdChange}
        onSubmit={vi.fn()}
        disabled={false}
      />,
    );

    await user.type(screen.getByTestId("runtime-text-input"), "A 草稿");
    view.rerender(
      <RuntimeComposer
        manifest={manifest([ENTRY_A, ENTRY_B])}
        activeEntryId="entry-b"
        onActiveEntryIdChange={onActiveEntryIdChange}
        onSubmit={vi.fn()}
        disabled={false}
      />,
    );
    await user.type(screen.getByTestId("runtime-text-input"), "B 草稿");
    view.rerender(
      <RuntimeComposer
        manifest={manifest([
          { ...ENTRY_A, displayName: "已重命名" },
          ENTRY_B,
        ])}
        activeEntryId="entry-a"
        onActiveEntryIdChange={onActiveEntryIdChange}
        onSubmit={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByTestId("runtime-text-input")).toHaveValue("A 草稿");
    view.rerender(
      <RuntimeComposer
        manifest={manifest([ENTRY_A, ENTRY_B])}
        activeEntryId="entry-b"
        onActiveEntryIdChange={onActiveEntryIdChange}
        onSubmit={vi.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByTestId("runtime-text-input")).toHaveValue("B 草稿");
  });

  it("retains an existing unsupported attachment while omitting its add control and warning explicitly", () => {
    const view = render(
      <RuntimeComposer
        manifest={manifest([ENTRY_A, ENTRY_B])}
        activeEntryId="entry-a"
        onActiveEntryIdChange={vi.fn()}
        onSubmit={vi.fn()}
        disabled={false}
      />,
    );

    const photo = new File(["photo"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("图片"), {
      target: { files: [photo] },
    });
    view.rerender(
      <RuntimeComposer
        manifest={manifest([
          { ...ENTRY_A, acceptedParts: ["text"] },
          ENTRY_B,
        ])}
        activeEntryId="entry-a"
        onActiveEntryIdChange={vi.fn()}
        onSubmit={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.queryByTestId("runtime-add-image")).not.toBeInTheDocument();
    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(
      screen.getByText("当前入口已不接受该附件，请删除或切回支持它的入口"),
    ).toBeInTheDocument();
  });

  it("filters revoked text, Skill, and plugin drafts out of the active-entry payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    const revocableEntry = entry("entry-revocable", "可撤销入口", {
      acceptedParts: ["text", "file"],
      exposedSkills: ["skill.allowed"],
      exposedPluginActions: ["plugin.allowed"],
    });
    const view = render(
      <RuntimeComposer
        manifest={manifest([revocableEntry])}
        activeEntryId={revocableEntry.id}
        onActiveEntryIdChange={vi.fn()}
        onSubmit={onSubmit}
        disabled={false}
      />,
    );

    await user.type(screen.getByTestId("runtime-text-input"), "不得提交的旧文本");
    fireEvent.change(screen.getByLabelText("文件"), {
      target: { files: [new File(["data"], "allowed.txt")] },
    });
    await user.selectOptions(screen.getByTestId("runtime-skill-menu"), "skill.allowed");
    await user.selectOptions(screen.getByTestId("runtime-plugin-menu"), "plugin.allowed");

    view.rerender(
      <RuntimeComposer
        manifest={manifest([
          {
            ...revocableEntry,
            acceptedParts: ["file"],
            exposedSkills: [],
            exposedPluginActions: [],
          },
        ])}
        activeEntryId={revocableEntry.id}
        onActiveEntryIdChange={vi.fn()}
        onSubmit={onSubmit}
        disabled={false}
      />,
    );

    expect(screen.queryByTestId("runtime-text-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-skill-menu")).not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-plugin-menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("runtime-send")).toBeEnabled();

    await user.click(screen.getByTestId("runtime-send"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        entryId: "entry-revocable",
        attachments: [
          {
            id: "entry-revocable-file-1",
            kind: "file",
            name: "allowed.txt",
            bytes: 4,
          },
        ],
      });
    });
  });

  it("keeps revoked scalar drafts for capability restoration without enabling submit", async () => {
    const user = userEvent.setup();
    const revocableEntry = entry("entry-revocable", "可撤销入口", {
      acceptedParts: ["text"],
      exposedSkills: ["skill.allowed"],
      exposedPluginActions: ["plugin.allowed"],
    });
    const view = render(
      <RuntimeComposer
        manifest={manifest([revocableEntry])}
        activeEntryId={revocableEntry.id}
        onActiveEntryIdChange={vi.fn()}
        onSubmit={vi.fn()}
        disabled={false}
      />,
    );

    await user.type(screen.getByTestId("runtime-text-input"), "待恢复文本");
    await user.selectOptions(screen.getByTestId("runtime-skill-menu"), "skill.allowed");
    await user.selectOptions(screen.getByTestId("runtime-plugin-menu"), "plugin.allowed");

    view.rerender(
      <RuntimeComposer
        manifest={manifest([
          {
            ...revocableEntry,
            acceptedParts: [],
            exposedSkills: [],
            exposedPluginActions: [],
          },
        ])}
        activeEntryId={revocableEntry.id}
        onActiveEntryIdChange={vi.fn()}
        onSubmit={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByTestId("runtime-send")).toBeDisabled();

    view.rerender(
      <RuntimeComposer
        manifest={manifest([revocableEntry])}
        activeEntryId={revocableEntry.id}
        onActiveEntryIdChange={vi.fn()}
        onSubmit={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByTestId("runtime-text-input")).toHaveValue("待恢复文本");
    expect(screen.getByTestId("runtime-skill-menu")).toHaveValue("skill.allowed");
    expect(screen.getByTestId("runtime-plugin-menu")).toHaveValue("plugin.allowed");
  });

  it("blocks unsupported attachments until support returns or the chip is deleted", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    const view = render(
      <RuntimeComposer
        manifest={manifest([ENTRY_A])}
        activeEntryId="entry-a"
        onActiveEntryIdChange={vi.fn()}
        onSubmit={onSubmit}
        disabled={false}
      />,
    );

    await user.type(screen.getByTestId("runtime-text-input"), "仍支持的文本");
    fireEvent.change(screen.getByLabelText("图片"), {
      target: { files: [new File(["photo"], "photo.png", { type: "image/png" })] },
    });

    const textOnlyEntry = { ...ENTRY_A, acceptedParts: ["text"] as const };
    view.rerender(
      <RuntimeComposer
        manifest={manifest([textOnlyEntry])}
        activeEntryId="entry-a"
        onActiveEntryIdChange={vi.fn()}
        onSubmit={onSubmit}
        disabled={false}
      />,
    );
    expect(screen.getByTestId("runtime-send")).toBeDisabled();

    view.rerender(
      <RuntimeComposer
        manifest={manifest([ENTRY_A])}
        activeEntryId="entry-a"
        onActiveEntryIdChange={vi.fn()}
        onSubmit={onSubmit}
        disabled={false}
      />,
    );
    expect(screen.getByTestId("runtime-send")).toBeEnabled();

    view.rerender(
      <RuntimeComposer
        manifest={manifest([textOnlyEntry])}
        activeEntryId="entry-a"
        onActiveEntryIdChange={vi.fn()}
        onSubmit={onSubmit}
        disabled={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "删除 photo.png" }));
    expect(screen.getByTestId("runtime-send")).toBeEnabled();
    await user.click(screen.getByTestId("runtime-send"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        entryId: "entry-a",
        text: "仍支持的文本",
        attachments: [],
      });
    });
  });

  it.each(["RUN_FAILED", "RUN_CANCELLED"])(
    "preserves the active draft when submission rejects with %s",
    async (rejectionCode) => {
      const user = userEvent.setup();
      render(
        <RuntimeComposer
          manifest={manifest([ENTRY_A])}
          activeEntryId="entry-a"
          onActiveEntryIdChange={vi.fn()}
          onSubmit={vi.fn(async () => {
            throw new Error(rejectionCode);
          })}
          disabled={false}
        />,
      );

      await user.type(screen.getByTestId("runtime-text-input"), "保留以便重试");
      await user.click(screen.getByTestId("runtime-send"));

      await waitFor(() => {
        expect(screen.getByTestId("runtime-text-input")).toHaveValue("保留以便重试");
      });
    },
  );
});
