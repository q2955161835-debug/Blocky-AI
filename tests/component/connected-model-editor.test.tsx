// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Resource } from "../../packages/language-schema/src";
import type { ModelProvider } from "../../packages/resource-registry/src";
import { ConnectedModelEditor } from "../../apps/studio-desktop/src/app/ConnectedModelEditor";

afterEach(cleanup);

function resource(): Resource {
  return {
    schemaVersion: "blocky.resource/v1alpha1",
    resourceId: "connected-model",
    displayName: "Connected model",
    kind: "model",
    scope: "user",
    definition: {
      connectionRef: "vendor",
      modelId: "large-output-model",
      timeoutMs: 3600000,
      capabilities: ["text"],
      parameters: { maxOutputTokens: 10000000 },
    },
    secretBindings: [],
    capabilityRequirements: [],
  };
}

it("keeps an existing maximum output value and makes the no-limit state clear", () => {
  const change = vi.fn();
  render(
    <ConnectedModelEditor
      resource={resource()}
      providers={[] as ModelProvider[]}
      change={change}
    />,
  );
  const outputLimit = screen.getByLabelText(
    "模型参数 输出 Token 上限",
  ) as HTMLInputElement;
  expect(outputLimit.value).toBe("10000000");
  expect(outputLimit.max).toBe("10000000");
  expect(screen.getByText(/未勾选时，不向模型请求发送输出上限参数/)).toBeTruthy();
  expect(change).not.toHaveBeenCalled();
});

it("removes the output limit only when the user explicitly disables it", () => {
  const change = vi.fn();
  render(
    <ConnectedModelEditor
      resource={resource()}
      providers={[] as ModelProvider[]}
      change={change}
    />,
  );
  fireEvent.click(screen.getByLabelText("设置模型参数 输出 Token 上限"));
  expect(change).toHaveBeenCalledWith(
    expect.objectContaining({
      definition: expect.objectContaining({
        parameters: {},
      }),
    }),
  );
});
