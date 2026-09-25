import { expect, it } from "vitest";
import { commands } from "../src";

it("uses one command registry for five context menu scopes", () => {
  const scopes = ["blank", "block", "multi", "library", "event"];
  for (const scope of scopes) {
    const choices = commands.filter((command) => command.contexts.includes(scope));
    expect(choices.length).toBeGreaterThan(0);
    expect(choices.every((command) => command.contexts.includes("studio") || command.commandId === "edit.insert-block")).toBe(true);
  }
  expect(commands.find((command) => command.commandId === "edit.insert-block")?.contexts).toContain("library");
  expect(commands.find((command) => command.commandId === "edit.group")?.contexts).toContain("multi");
  expect(commands.find((command) => command.commandId === "run.toggle-breakpoint")?.contexts).toContain("event");
});
