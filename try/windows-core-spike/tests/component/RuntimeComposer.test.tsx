import { fireEvent, render, screen } from "@testing-library/react";
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
});
