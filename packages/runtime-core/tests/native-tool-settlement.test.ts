import { expect, it, vi } from "vitest";
import { nativeAgentServices } from "../src/native-agent";
import { createAgentExample } from "../../block-catalog/src";
it("native close waits for the cancelled tool request without replaying it", async () => {
  const controller = new AbortController(),
    operations: string[] = [];
  let rejectCall!: (error: Error) => void;
  const services = nativeAgentServices(async (operation) => {
    operations.push(operation);
    if (operation === "tool-call")
      return new Promise((_, reject) => {
        rejectCall = reject;
      });
    return {};
  });
  const resource = createAgentExample().resources["text-tool"];
  resource.definition.implementationRef = {
    kind: "adapter",
    id: "http-json-v1",
  };
  resource.definition.timeoutMs = 3000;
  const request = services.tool!(
    {
      projectId: "project-test",
      runId: "run-test",
      requestId: "request-test",
      resource,
      input: { text: "public" },
    },
    controller.signal,
  ).catch((error) => error);
  await vi.waitFor(() => expect(rejectCall).toBeTypeOf("function"));
  controller.abort();
  let closed = false;
  const pending = services.close!(controller.signal).then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(operations).toEqual(["tool-call", "tool-cancel"]);
  rejectCall(Error("BLK-TOOL-CANCELLED"));
  await request;
  await pending;
  expect(closed).toBe(true);
});
