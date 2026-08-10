import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { buildEditorProjection } from "../../src/blockly/BlocklyCanvas";
import { createHundredBlockWorkspaceState } from "../../src/blockly/fixtures";
import type { RuntimeDependencies } from "../../src/core/deterministicRuntime";
import { stableStringify, type JsonValue } from "../../src/core/json";
import { InMemoryHostBridge } from "../../src/host/InMemoryHostBridge";
import { createSpikeProjectSnapshot } from "../../src/project/SpikeProjectSnapshot";

type ReplacementName = "清空" | "载入100块" | "重开";

function workspaceWithEntryName(name: string): JsonValue {
  const state = structuredClone(createHundredBlockWorkspaceState()) as JsonValue;
  const rename = (value: JsonValue): boolean => {
    if (Array.isArray(value)) return value.some(rename);
    if (value === null || typeof value !== "object") return false;
    if (value.id === "block-002") {
      value.fields = { NAME: name };
      return true;
    }
    return Object.values(value).some(rename);
  };
  if (!rename(state)) throw new Error("TEST_ENTRY_BLOCK_UNAVAILABLE");
  return state;
}

async function seedProject(
  host: InMemoryHostBridge,
  workspace: JsonValue,
): Promise<void> {
  const projection = buildEditorProjection(workspace);
  const project = createSpikeProjectSnapshot({
    projectId: "windows-core-spike",
    workspace: projection.workspace,
    program: projection.program,
    interactionManifest: projection.interactionManifest,
  });
  await host.saveProject({
    projectId: project.projectId,
    json: stableStringify(project),
  });
}

async function renderReplacementCase(
  replacement: ReplacementName,
  runtimeModel?: RuntimeDependencies["model"],
): Promise<void> {
  const host = new InMemoryHostBridge();
  if (replacement === "重开") {
    await seedProject(host, workspaceWithEntryName("Disk Chat"));
  }
  render(
    <App
      hostBridge={host}
      initialWorkspace={workspaceWithEntryName("Before Chat")}
      runtimeModel={runtimeModel}
    />,
  );
  await waitFor(() => {
    expect(screen.getByTestId("runtime-entry-select")).toHaveTextContent(
      "Before Chat",
    );
  });
}

async function expectReplacement(replacement: ReplacementName): Promise<void> {
  if (replacement === "清空") {
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeDisabled();
    });
    return;
  }
  await waitFor(() => {
    expect(screen.getByTestId("runtime-entry-select")).toHaveTextContent(
      replacement === "载入100块" ? "Chat" : "Disk Chat",
    );
  });
}

function createAbortGatedModel(): {
  readonly model: RuntimeDependencies["model"];
  readonly started: Promise<void>;
  readonly aborted: Promise<void>;
  release(): void;
} {
  let resolveStarted!: () => void;
  let resolveAborted!: () => void;
  let resolveRelease!: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const aborted = new Promise<void>((resolve) => {
    resolveAborted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  return {
    model: {
      async *stream(_input, signal) {
        resolveStarted();
        signal.addEventListener("abort", () => resolveAborted(), { once: true });
        await released;
      },
    },
    started,
    aborted,
    release: resolveRelease,
  };
}

describe.each<ReplacementName>(["清空", "载入100块", "重开"])(
  "workspace replacement through %s",
  (replacement) => {
    it("aborts and settles an active model run before replacing the workspace", async () => {
      const user = userEvent.setup();
      const gate = createAbortGatedModel();
      await renderReplacementCase(replacement, gate.model);
      await user.type(screen.getByTestId("runtime-text-input"), "old model run");
      await user.click(screen.getByTestId("runtime-send"));
      await gate.started;

      await user.click(screen.getByRole("button", { name: replacement }));
      try {
        await expect(gate.aborted).resolves.toBeUndefined();
        expect(screen.getByTestId("runtime-entry-select")).toHaveTextContent(
          "Before Chat",
        );
      } finally {
        await act(async () => gate.release());
      }

      await expectReplacement(replacement);
      expect(await screen.findByText("run.cancelled")).toBeInTheDocument();
      expect(screen.queryByText("run.completed")).not.toBeInTheDocument();
    });

    it("settles a pending permission run and never revives its old prompt", async () => {
      const user = userEvent.setup();
      await renderReplacementCase(replacement);
      await user.type(screen.getByTestId("runtime-text-input"), "/permission");
      await user.click(screen.getByTestId("runtime-send"));
      await screen.findByRole("alertdialog", { name: "工具权限请求" });

      await user.click(screen.getByRole("button", { name: replacement }));
      await expectReplacement(replacement);
      expect(await screen.findByText("run.cancelled")).toBeInTheDocument();
      expect(
        screen.queryByRole("alertdialog", { name: "工具权限请求" }),
      ).not.toBeInTheDocument();

      if (replacement !== "清空") {
        await user.click(screen.getByRole("button", { name: "清空" }));
      }
      await user.click(screen.getByRole("button", { name: "载入100块" }));
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeEnabled();
      });
      expect(
        screen.queryByRole("alertdialog", { name: "工具权限请求" }),
      ).not.toBeInTheDocument();
    });
  },
);
