import { describe, expect, it } from "vitest";
import {
  emptyBindings,
  changeBinding,
  parseBindings,
  normalizeShortcut,
  bindingsFor,
} from "../src/index";
describe("custom keyboard bindings", () => {
  it("normalizes, persists, disables and restores commands without mutating defaults", () => {
    const original = emptyBindings();
    const custom = changeBinding(original, "file.save", ["Shift+Ctrl+l"]);
    expect(
      bindingsFor(
        parseBindings(JSON.parse(JSON.stringify(custom))),
        "file.save",
      ),
    ).toEqual(["Ctrl+Shift+L"]);
  });
  it("rejects conflicts and system keys atomically", () => {
    const original = emptyBindings();
    expect(() => changeBinding(original, "file.save", ["Ctrl+O"])).toThrow(
      "冲突",
    );
    expect(original.overrides).toEqual({});
    expect(() => normalizeShortcut("Alt+F4")).toThrow("系统");
    const disabled = changeBinding(original, "file.save", []);
    expect(bindingsFor(disabled, "file.save")).toEqual([]);
    expect(
      bindingsFor(changeBinding(disabled, "file.save", undefined), "file.save"),
    ).toEqual(["Ctrl+S"]);
  });
});
