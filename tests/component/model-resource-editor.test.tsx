// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Resource } from "../../packages/language-schema/src";
import {
  ModelResourceEditor,
  modelResourceError,
} from "../../apps/studio-desktop/src/app/ModelResourceEditor";

afterEach(cleanup);
function resource(): Resource {
  return {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId: "test-model",
    kind: "model",
    scope: "user",
    displayName: "My model",
    definition: {
      provider: "deepseek",
      modelId: "my-existing-model",
      protocol: "openai-chat",
      timeoutMs: 42000,
      capabilities: ["text", "tools"],
      parameters: { temperature: 0.7, topP: 0.8 },
      implementationRef: { kind: "adapter", id: "deepseek-v1" },
    },
    secretBindings: [{ fieldId: "apiKey", secretRef: "existing-key" }],
    capabilityRequirements: [],
  };
}
function Editor({ initial = resource() }: { initial?: Resource }) {
  const [value, change] = useState(initial);
  return (
    <>
      <ModelResourceEditor resource={value} change={change} />
      <output data-testid="resource">{JSON.stringify(value)}</output>
    </>
  );
}
function current(): Resource {
  return JSON.parse(screen.getByTestId("resource").textContent!);
}

it("preserves existing values and bindings when rendered and edits ordinary model fields", () => {
  const initial = resource();
  render(<Editor initial={initial} />);
  expect(current()).toEqual(initial);
  fireEvent.change(screen.getByLabelText("模型服务类型"), {
    target: { value: "deepseek" },
  });
  expect(current()).toEqual(initial);
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "chosen-model" },
  });
  fireEvent.change(screen.getByLabelText("温度"), { target: { value: "0.4" } });
  expect(current().definition.modelId).toBe("chosen-model");
  expect(current().definition.parameters).toEqual({
    temperature: 0.4,
    topP: 0.8,
  });
  expect(current().secretBindings).toEqual(initial.secretBindings);
  expect(screen.queryByLabelText("端点")).toBeNull();
  expect(screen.queryByLabelText("API 密钥")).toBeNull();
});

it("derives custom and Ollama adapters only on explicit selection without changing secret bindings", () => {
  render(<Editor />);
  fireEvent.change(screen.getByLabelText("模型服务类型"), {
    target: { value: "openai-compatible" },
  });
  expect(current().definition).toMatchObject({
    provider: "openai-compatible",
    protocol: "openai-chat",
    implementationRef: { kind: "adapter", id: "openai-compatible-v1" },
  });
  expect(current().definition.parameters).not.toHaveProperty("maxOutputTokens");
  expect(current().secretBindings).toEqual(resource().secretBindings);
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "custom-model" },
  });
  expect(screen.getByRole("alert").textContent).toContain("baseUrl");
  fireEvent.change(screen.getByLabelText("模型服务类型"), {
    target: { value: "ollama" },
  });
  expect(current().definition.implementationRef).toEqual({
    kind: "adapter",
    id: "ollama-v1",
  });
});

it("creates a managed Qwen profile in user scope with declared capabilities", () => {
  const initial = resource();
  initial.scope = "project";
  initial.secretBindings = [];
  render(<Editor initial={initial} />);
  fireEvent.change(screen.getByLabelText("模型服务类型"), {
    target: { value: "managed-local" },
  });
  expect(current()).toMatchObject({
    scope: "user",
    secretBindings: [],
    definition: {
      provider: "managed-local",
      protocol: "local",
      modelId: "qwen3-0.6b-q8-v1",
      implementationRef: { kind: "adapter", id: "managed-local-v1" },
      capabilities: ["text", "tools", "structured-output"],
    },
  });
  expect((screen.getByLabelText("模型 ID") as HTMLInputElement).readOnly).toBe(
    true,
  );
});

it("requires removing existing secret bindings before switching to managed local", () => {
  render(<Editor />);
  fireEvent.change(screen.getByLabelText("模型服务类型"), {
    target: { value: "managed-local" },
  });
  expect(current()).toEqual(resource());
  expect(screen.getByRole("alert").textContent).toContain("秘密引用");
});

it("keeps unknown advanced profiles unchanged and rejects invalid visible fields", () => {
  const initial = resource();
  initial.definition.provider = "other";
  initial.definition.protocol = "native";
  render(<Editor initial={initial} />);
  expect(current()).toEqual(initial);
  fireEvent.change(screen.getByLabelText("模型服务类型"), {
    target: { value: "deepseek" },
  });
  fireEvent.change(screen.getByLabelText("超时（毫秒）"), {
    target: { value: "0" },
  });
  expect(screen.getByRole("alert").textContent).toContain("超时");
  expect(modelResourceError(current())).toContain("超时");
});

it("changes declared capabilities and omits cleared optional parameters", () => {
  render(<Editor />);
  fireEvent.click(screen.getByLabelText("结构化输出"));
  expect(current().definition.capabilities).toEqual([
    "text",
    "tools",
    "structured-output",
  ]);
  fireEvent.change(screen.getByLabelText("温度"), { target: { value: "" } });
  expect(current().definition.parameters).toEqual({ topP: 0.8 });
});

it("accepts resource-registry model limits and preserves existing values", () => {
  const value = resource();
  value.definition.timeoutMs = 3600000;
  value.definition.parameters = { maxOutputTokens: 10000000 };
  expect(modelResourceError(value)).toBe("");
  render(<Editor initial={value} />);
  expect((screen.getByLabelText("超时（毫秒）") as HTMLInputElement).max).toBe(
    "3600000",
  );
  expect((screen.getByLabelText("输出上限") as HTMLInputElement).max).toBe(
    "10000000",
  );
  expect(current()).toEqual(value);
  expect(screen.getByText(/留空时不设置输出上限/)).toBeTruthy();
  value.definition.timeoutMs = 3600001;
  expect(modelResourceError(value)).toContain("3600000");
  value.definition.timeoutMs = 3600000;
  value.definition.parameters = { maxOutputTokens: 10000001 };
  expect(modelResourceError(value)).toContain("10000000");
});

it("explains that an empty output limit leaves the model output unrestricted", () => {
  const initial = resource();
  initial.definition.parameters = { maxOutputTokens: 12000 };
  render(<Editor initial={initial} />);
  expect(screen.getByText(/留空时不设置输出上限/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("输出上限"), {
    target: { value: "" },
  });
  expect(current().definition.parameters).toEqual({});
  expect(screen.queryByLabelText("图像")).toBeNull();
  expect(screen.queryByLabelText("音频")).toBeNull();
  expect(screen.queryByLabelText("向量")).toBeNull();
});
