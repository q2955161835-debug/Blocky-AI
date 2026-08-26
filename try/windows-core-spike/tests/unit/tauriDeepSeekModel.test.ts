import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTauriDeepSeekModel } from "../../src/host/TauriDeepSeekModel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

async function collect(
  model: ReturnType<typeof createTauriDeepSeekModel>,
  signal: AbortSignal = new AbortController().signal,
): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of model.stream("trusted-context", signal)) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

describe("TauriDeepSeekModel", () => {
  beforeEach(() => invokeMock.mockReset());

  it("invokes the narrow Host command and exposes only safe live-call evidence", async () => {
    invokeMock.mockResolvedValueOnce({
      content: "{\"schema\":\"blocky.course-draft/v1\"}",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      requestId: "response-safe-1",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    const model = createTauriDeepSeekModel();

    await expect(collect(model)).resolves.toContain("blocky.course-draft/v1");
    expect(invokeMock).toHaveBeenCalledWith("deepseek_chat_completion", {
      request: {
        input: "trusted-context",
        requestId: expect.any(String),
      },
    });
    expect(model.takeLastCallReport?.()).toEqual({
      live: true,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      requestId: "response-safe-1",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    expect(model.takeLastCallReport?.()).toBeNull();
  });

  it("maps Host failures to a stable code without echoing provider details", async () => {
    invokeMock.mockRejectedValueOnce({
      code: "DEEPSEEK_AUTH_FAILED",
      message: "sensitive provider detail",
    });
    const model = createTauriDeepSeekModel();

    await expect(collect(model)).rejects.toMatchObject({
      name: "RuntimeModelError",
      code: "DEEPSEEK_AUTH_FAILED",
      message: "DEEPSEEK_AUTH_FAILED",
    });
  });

  it("returns immediately on abort and asks the Host to cancel the matching request", async () => {
    invokeMock.mockImplementation((command) => {
      if (command === "deepseek_chat_completion") {
        return new Promise(() => undefined);
      }
      if (command === "cancel_deepseek_completion") {
        return Promise.resolve(true);
      }
      return Promise.resolve(undefined);
    });
    const controller = new AbortController();
    const model = createTauriDeepSeekModel();
    const collection = collect(model, controller.signal);

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("deepseek_chat_completion", {
        request: {
          input: "trusted-context",
          requestId: expect.any(String),
        },
      });
    });
    const requestCall = invokeMock.mock.calls.find(([command]) =>
      command === "deepseek_chat_completion"
    );
    const requestId = (requestCall?.[1] as { request: { requestId: string } })
      .request.requestId;
    controller.abort();
    const outcome = await Promise.race([
      collection.then(
        () => "resolved",
        (error: unknown) => error,
      ),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);

    expect(outcome).toMatchObject({ name: "AbortError" });
    expect(invokeMock).toHaveBeenCalledWith("cancel_deepseek_completion", { requestId });
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "deepseek_chat_completion",
      "cancel_deepseek_completion",
    ]);
  });
});
