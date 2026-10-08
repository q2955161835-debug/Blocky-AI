// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReasoningPicker } from "../../apps/studio-desktop/src/app/ReasoningPicker";
import { modelResource } from "../fixtures/model-resource";
afterEach(cleanup);
it("offers only supported levels and forwards explicit choices", () => {
  const resource = modelResource("deepseek-model");
  resource.definition.provider = "deepseek";
  resource.definition.modelId = "deepseek-v4-pro";
  const change = vi.fn();
  render(<ReasoningPicker label="思考等级" value="none" model={resource} disabled={false} change={change} />);
  const picker = screen.getByRole("combobox", { name: "思考等级" }) as HTMLSelectElement;
  expect([...picker.options].map(option => option.value)).toEqual(["none", "low", "high", "max"]);
  fireEvent.change(picker, {target: {value: "high"}});
  expect(change).toHaveBeenCalledExactlyOnceWith("high");
});
it("keeps unsupported stored effort visible and permits an explicit reset without silently downgrading", () => {
  const change = vi.fn();
  const resource = modelResource("unsupported-model");
  resource.definition.provider = "custom";
  resource.definition.modelId = "unsupported-model";
  render(<ReasoningPicker label="思考等级" value="high" model={resource} disabled={false} change={change} />);
  const picker = screen.getByRole("combobox", { name: "思考等级" }) as HTMLSelectElement;
  expect(picker.value).toBe("high");
  expect(picker.selectedOptions[0].textContent).toContain("不可用");
  expect(change).not.toHaveBeenCalled();
  expect(picker.disabled).toBe(false);
  fireEvent.change(picker, {target: {value: "none"}});
  expect(change).toHaveBeenCalledExactlyOnceWith("none");
});
