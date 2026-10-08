// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useUiPreferences } from "../../apps/studio-desktop/src/composition/useUiPreferences";
import { parseUiPreferences } from "../../apps/studio-desktop/src/composition/uiPreferences";
beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);
it("persists appearance and builder choice without modifying legacy settings", async () => {
  const legacy =
    '{"schemaVersion":"blocky.settings/v1","scope":"app","values":{"ui.view":"professional"}}';
  localStorage.setItem("blocky.settings.app", legacy);
  const first = renderHook(() => useUiPreferences(vi.fn()));
  await waitFor(() => expect(first.result.current.ready).toBe(true));
  act(() => first.result.current.change("theme", "light"));
  act(() => first.result.current.change("fontSize", 18));
  act(() => first.result.current.change("builderModelId", "model-test"));
  act(() => first.result.current.change("agentModelId", "agent-model-test"));
  act(() => first.result.current.change("builderReasoningEffort", "high"));
  act(() => first.result.current.change("agentReasoningEffort", "low"));
  await act(() => first.result.current.flush());
  expect(localStorage.getItem("blocky.settings.app")).toBe(legacy);
  first.unmount();
  const reopened = renderHook(() => useUiPreferences(vi.fn()));
  await waitFor(() =>
    expect(reopened.result.current.values).toMatchObject({
      theme: "light",
      fontSize: 18,
      builderModelId: "model-test",
      agentModelId: "agent-model-test",
      builderReasoningEffort: "high",
      agentReasoningEffort: "low",
    }),
  );
});
it("reloads shared settings on focus and preserves changes made by another window", async () => {
  const first = renderHook(() => useUiPreferences(vi.fn()));
  const second = renderHook(() => useUiPreferences(vi.fn()));
  await waitFor(() =>
    expect(first.result.current.ready && second.result.current.ready).toBe(
      true,
    ),
  );
  act(() => first.result.current.change("theme", "light"));
  await act(() => first.result.current.flush());
  act(() => second.result.current.change("fontSize", 20));
  await act(() => second.result.current.flush());
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() =>
    expect(first.result.current.values).toMatchObject({
      theme: "light",
      fontSize: 20,
    }),
  );
});
it("rejects invalid values and retains corrupt stored preferences", async () => {
  expect(() =>
    parseUiPreferences({
      schemaVersion: "blocky.ui-preferences/v1",
      values: { fontSize: 0 },
    }),
  ).toThrow();
  expect(() =>
    parseUiPreferences({
      schemaVersion: "blocky.ui-preferences/v1",
      values: { fontFamily: "arbitrary css" },
    }),
  ).toThrow();
  localStorage.setItem(
    "blocky.ui-preferences.app",
    '{"schemaVersion":"future","values":{}}',
  );
  const view = renderHook(() => useUiPreferences(vi.fn()));
  await waitFor(() => expect(view.result.current.error).toBeTruthy());
  expect(() => view.result.current.change("theme", "light")).toThrow();
  expect(localStorage.getItem("blocky.ui-preferences.app")).toContain("future");
});
