// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createStarter } from "../../packages/test-fixtures/src";
import { restoreSession, serializeSession } from "../../packages/project-model/src";

const io = vi.hoisted(() => ({
  opened: null as any,
  pending: Promise.resolve(null) as Promise<unknown>,
  writes: [] as Array<{ id: string; value: any }>,
}));
vi.mock("../../apps/studio-desktop/src/composition/host", async (original) => ({
  ...await original<typeof import("../../apps/studio-desktop/src/composition/host")>(),
  openProject: async () => io.opened,
}));
vi.mock("../../apps/studio-desktop/src/composition/userState", () => ({
  readUserState: async (kind: string, id: string) => kind === "session" && id === "saved-layout-project" ? io.pending : null,
  writeUserState: async (kind: string, id: string, value: unknown) => { if (kind === "session") io.writes.push({ id, value }); },
  clearUserState: async () => {},
}));
vi.mock("../../packages/ui-editor/src/index.ts", () => ({
  Canvas: (props: any) => {
    useEffect(() => {
      const timer = setTimeout(() => props.onViewport(props.viewport ?? { offsetX: 0, offsetY: 0, scale: 0.85 }), 0);
      return () => clearTimeout(timer);
    }, []);
    return <div data-testid="restored-canvas" data-scale={props.viewport?.scale}>画布</div>;
  },
}));
import { App } from "../../apps/studio-desktop/src/app/App";
afterEach(() => { cleanup(); localStorage.clear(); io.writes = []; });

it("waits for saved layout before mounting the canvas and preserves it across a new app instance", async () => {
  const project = createStarter();
  project.manifest.projectId = "saved-layout-project";
  const session = { ...restoreSession(project, null), leftWidth: 293, rightWidth: 406, height: 286, panel: true, rightView: "builder" as const };
  session.viewports[session.active] = { offsetX: 80, offsetY: -50, scale: 1.2 };
  const saved = serializeSession(project, session);
  let resolve!: (value: unknown) => void;
  io.pending = new Promise(r => { resolve = r; });
  io.opened = { project, handle: { id: "saved", displayName: "saved.blocky" } };
  let app = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开本机项目" }));
  await act(async () => { await new Promise(r => setTimeout(r, 300)); });
  expect(screen.queryByTestId("restored-canvas")).toBeNull();
  expect(io.writes.filter(w => w.id === project.manifest.projectId)).toEqual([]);
  await act(async () => { resolve(saved); });
  await screen.findByTestId("restored-canvas");
  expect(screen.getByTestId("restored-canvas").getAttribute("data-scale")).toBe("1.2");
  expect(screen.getByRole("separator", { name: "左侧积木库宽度" }).getAttribute("aria-valuenow")).toBe("293");
  expect(screen.getByRole("region", { name: "底部面板" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("separator", { name: "左侧积木库宽度" }), { key: "ArrowRight" });
  await waitFor(() => expect(io.writes.filter(w => w.id === project.manifest.projectId).at(-1)?.value.sidebars.leftWidth).toBe(303));
  const persisted = io.writes.filter(w => w.id === project.manifest.projectId).at(-1)!.value;
  app.unmount();
  io.pending = Promise.resolve(persisted);
  app = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开本机项目" }));
  await screen.findByTestId("restored-canvas");
  expect(screen.getByRole("separator", { name: "左侧积木库宽度" }).getAttribute("aria-valuenow")).toBe("303");
  expect(screen.getByRole("separator", { name: "底部面板高度" }).getAttribute("aria-valuenow")).toBe("286");
  expect(screen.getByRole("tab", { name: "构建助手" }).getAttribute("aria-selected")).toBe("true");
});
