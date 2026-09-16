import { expect, test } from "vitest";
import * as commandSystem from "../src/index";
test("all command surfaces share availability, execution and disable reasons", () => {
  expect(commandSystem).toHaveProperty("createCommandDispatcher");
  const { createCommandDispatcher } = commandSystem as typeof commandSystem & {
    createCommandDispatcher: (
      actions: Record<string, () => void>,
      reason: (id: string) => string | undefined,
    ) => {
      state(id: string): { enabled: boolean; reason?: string };
      execute(id: string): boolean;
    };
  };
  let count = 0;
  const dispatcher = createCommandDispatcher(
    { "file.save": () => count++ },
    () => undefined,
  );
  expect(dispatcher.execute("file.save")).toBe(true);
  expect(count).toBe(1);
  expect(dispatcher.state("arbitrary.command")).toMatchObject({
    enabled: false,
  });
  const busy = createCommandDispatcher(
    { "file.save": () => count++ },
    () => "正在保存",
  );
  expect(busy.state("file.save")).toEqual({
    enabled: false,
    reason: "正在保存",
  });
  expect(busy.execute("file.save")).toBe(false);
  expect(count).toBe(1);
});
test("primary shortcuts follow the approved workbench bindings", () => {
  expect(
    commandSystem.commands.find((c) => c.commandId === "run.start")!
      .defaultShortcuts,
  ).toContain("F5");
  expect(
    commandSystem.commands.find((c) => c.commandId === "edit.redo")!
      .defaultShortcuts,
  ).toContain("Ctrl+Shift+Z");
  expect(
    commandSystem.commands.find((c) => c.commandId === "view.command-center")!
      .defaultShortcuts,
  ).toContain("Ctrl+K");
});
