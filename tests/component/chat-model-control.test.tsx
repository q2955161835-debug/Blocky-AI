// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatComposer } from "../../apps/studio-desktop/src/app/ChatComposer";
import { ChatModelControl } from "../../apps/studio-desktop/src/app/ChatModelControl";
import { modelResource } from "../fixtures/model-resource";
import type { ReasoningEffort } from "../../packages/builder-protocol/src";
afterEach(cleanup);
it("opens full controls above the input and preserves the draft while choosing both settings", () => {
  const resource = modelResource("xirang-model");
  resource.definition = { ...resource.definition, provider: "xirang", modelId: "deepseek-v4-pro" };
  function Harness() {
    const [model, setModel] = useState(resource.resourceId);
    const [effort, setEffort] = useState<ReasoningEffort>("none");
    const [text, setText] = useState("保留草稿");
    return <div className="chat-panel"><ChatComposer value={text} onChange={setText} onSubmit={vi.fn()} label="问题" placeholder="输入">
      <button type="button" aria-label="添加上下文">+</button>
      <ChatModelControl label="模型与思考" modelLabel="当前模型" reasoningLabel="思考等级" models={[resource]} value={model} effort={effort} disabled={false} changeModel={setModel} changeEffort={setEffort} />
      <button type="submit" aria-label="发送">发送</button>
    </ChatComposer></div>;
  }
  render(<Harness />);
  const trigger = screen.getByRole("button", { name: "模型与思考" });
  expect(trigger.textContent).toContain("deepseek-v4-pro");
  expect(screen.queryByRole("combobox", { name: "当前模型" })).toBeNull();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "模型与思考" });
  expect(dialog.closest("form")).toBeNull();
  expect(dialog.style.position).toBe("fixed");
  fireEvent.change(screen.getByRole("combobox", { name: "思考等级" }), { target: { value: "high" } });
  expect(trigger.textContent).toContain("高");
  expect((screen.getByRole("textbox", { name: "问题" }) as HTMLTextAreaElement).value).toBe("保留草稿");
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
