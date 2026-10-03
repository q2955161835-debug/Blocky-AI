import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentExample } from "../../packages/test-fixtures/src/scenarios";
import { canonicalJson } from "../../packages/language-schema/src";
import { createHash } from "node:crypto";
const native = vi.hoisted(() => ({
  read: vi.fn(),
  run: vi.fn(),
  write: vi.fn(),
  defaultModel: vi.fn(),
}));
vi.mock("../../tools/blocky-cli/src/native-store", () => ({
  readProject: native.read,
  nativeUserOperation: native.run,
}));
vi.mock("../../tools/blocky-cli/src/artifacts", () => ({
  readJsonArtifact: vi.fn(),
  writeJsonArtifact: native.write,
}));
vi.mock("../../tools/blocky-cli/src/user-config", () => ({
  readDefaultModelId: native.defaultModel,
}));
import { codingCommand, codingHelp } from "../../tools/blocky-cli/src/coding";
import { parse } from "../../tools/blocky-cli/src/arguments";
import { output } from "../../tools/blocky-cli/src/output";
import { discoveryCommand } from "../../tools/blocky-cli/src/discovery";
function result(start: {
  requestId: string;
  projectId: string;
  originalJson: string;
}) {
  return {
    schemaVersion: "blocky.coding-result/v1",
    requestId: start.requestId,
    projectId: start.projectId,
    baseDigest: createHash("sha256").update(start.originalJson).digest("hex"),
    text: "完成分析",
    changes: [],
    events: [],
    generations: [],
    engine: "test",
    modelApiCalled: false,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  native.read.mockResolvedValue(createAgentExample());
  native.defaultModel.mockResolvedValue("model-example");
  native.write.mockResolvedValue({
    path: "result.json",
    bytes: 100,
    sha256: "a".repeat(64),
  });
  native.run.mockImplementation(async (_operation, { start }) => result(start));
});
describe("coding CLI native boundary", () => {
  it("discovers all coding schemas including transformed candidate project", () => {
    expect(codingHelp[0]).toContain("--workspace");
    for (const id of [
      "blocky.coding-failure/v1",
      "blocky.coding-start/v1",
      "blocky.coding-event/v1",
      "blocky.coding-change/v1",
      "blocky.coding-result/v1",
    ]) {
      expect(
        discoveryCommand(parse(["schema", "show", id, "--json"]), [])?.code,
      ).toBe(0);
    }
  });
  it("passes only an opaque-free task to the native picker and approval", async () => {
    const project = createAgentExample();
    native.read.mockResolvedValue(project);
    await codingCommand(
      parse([
        "coding",
        "run",
        "test.blocky",
        "--module",
        "research-agent",
        "--prompt",
        "解释代码",
        "--workspace",
        "--output",
        "result.json",
        "--json",
      ]),
      new AbortController().signal,
    );
    const [operation, fields] = native.run.mock.calls[0];
    expect(operation).toBe("coding-run");
    expect(fields.pickWorkspace).toBe(true);
    expect(fields.start.workspaceId).toBeUndefined();
    expect(fields.start.originalJson).toBe(canonicalJson(project));
    expect(native.write).toHaveBeenCalledOnce();
  });
  it("rejects directory overrides and missing output before calling native model", async () => {
    await expect(
      codingCommand(
        parse([
          "coding",
          "run",
          "test.blocky",
          "--module",
          "research-agent",
          "--prompt",
          "test",
          "--directory",
          "/tmp",
          "--output",
          "result.json",
        ]),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "BLK-CLI-002" });
    await expect(
      codingCommand(
        parse([
          "coding",
          "run",
          "test.blocky",
          "--module",
          "research-agent",
          "--prompt",
          "test",
        ]),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "BLK-CLI-002" });
    expect(native.run).not.toHaveBeenCalled();
  });
  it("does not save a result belonging to a different task", async () => {
    native.run.mockImplementation(async (_operation, { start }) => ({
      ...result(start),
      requestId: "other-request",
    }));
    await expect(
      codingCommand(
        parse([
          "coding",
          "run",
          "test.blocky",
          "--module",
          "research-agent",
          "--prompt",
          "test",
          "--output",
          "result.json",
        ]),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "BLK-CODING-WIRE" });
    expect(native.write).not.toHaveBeenCalled();
  });
  it("writes bound native failure receipts despite cancellation and returns non-success", async () => {
    const controller = new AbortController();
    const change = {
      changeId: "change-one",
      path: "file.ts",
      before: null,
      after: "created",
      beforeDigest: null,
      afterDigest: createHash("sha256").update("created").digest("hex"),
    };
    native.run.mockImplementation(async (_operation, { start }) => {
      controller.abort();
      return {
        schemaVersion: "blocky.coding-failure/v1",
        requestId: start.requestId,
        projectId: start.projectId,
        baseDigest: result(start).baseDigest,
        code: "BLK-CODING-CANCELLED",
        changes: [change],
        modelApiCalled: true,
      };
    });
    const reply = await codingCommand(
      parse([
        "coding",
        "run",
        "test.blocky",
        "--module",
        "research-agent",
        "--prompt",
        "test",
        "--output",
        "failure.json",
      ]),
      controller.signal,
    );
    expect(reply?.code).toBe(7);
    expect(reply?.result.ok).toBe(false);
    expect(native.write.mock.calls[0][1].changes).toEqual([change]);
    expect(reply?.result.artifacts).toHaveLength(1);
  });
  it("rejects another request's failure receipt without writing it", async () => {
    native.run.mockImplementation(async (_operation, { start }) => ({
      schemaVersion: "blocky.coding-failure/v1",
      requestId: "other-task",
      projectId: start.projectId,
      baseDigest: result(start).baseDigest,
      code: "BLK-CODING-CANCELLED",
      changes: [],
      modelApiCalled: false,
    }));
    await expect(
      codingCommand(
        parse([
          "coding",
          "run",
          "test.blocky",
          "--module",
          "research-agent",
          "--prompt",
          "test",
          "--output",
          "failure.json",
        ]),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "BLK-CODING-WIRE" });
    expect(native.write).not.toHaveBeenCalled();
  });
  it("retains actual failure receipts in JSON output if artifact writing fails", async () => {
    native.run.mockImplementation(async (_operation, { start }) => ({
      schemaVersion: "blocky.coding-failure/v1",
      requestId: start.requestId,
      projectId: start.projectId,
      baseDigest: result(start).baseDigest,
      code: "BLK-CODING-CANCELLED",
      changes: [],
      modelApiCalled: true,
    }));
    native.write.mockRejectedValue(Error("disk full"));
    const reply = await codingCommand(
      parse([
        "coding",
        "run",
        "test.blocky",
        "--module",
        "research-agent",
        "--prompt",
        "test",
        "--output",
        "failure.json",
      ]),
      new AbortController().signal,
    );
    expect(reply?.code).toBe(6);
    expect(reply?.result.ok).toBe(false);
    expect(
      (reply?.result.data as { receipt: { modelApiCalled: boolean } }).receipt
        .modelApiCalled,
    ).toBe(true);
  });

  it("preserves a completed native task and file receipts when artifact publication fails", async () => {
    const change = {
      changeId: "actual-change",
      path: "file.ts",
      before: null,
      after: "created",
      beforeDigest: null,
      afterDigest: createHash("sha256").update("created").digest("hex"),
    };
    native.run.mockImplementation(async (_operation, { start }) => ({
      ...result(start),
      changes: [change],
    }));
    native.write.mockRejectedValue(Error("target already exists"));
    const reply = await codingCommand(
      parse([
        "coding",
        "run",
        "test.blocky",
        "--module",
        "research-agent",
        "--prompt",
        "test",
        "--output",
        "result.json",
      ]),
      new AbortController().signal,
    );
    expect(reply?.code).toBe(6);
    expect(reply?.result.ok).toBe(false);
    expect(reply?.result.error?.code).toBe("BLK-SAVE-001");
    expect(
      (reply?.result.data as { receipt: { changes: unknown[] } }).receipt
        .changes,
    ).toEqual([change]);
  });
  it.each([false, true])(
    "retains exact fallback JSON through output sanitizing (failure=%s)",
    async (failed) => {
      const text =
        String.raw`const drive = "C:\tmp"; const share = "\\server\share";` +
        "z".repeat(18000);
      const change = {
        changeId: "exact-change",
        path: "file.ts",
        before: null,
        after: text,
        beforeDigest: null,
        afterDigest: createHash("sha256").update(text).digest("hex"),
      };
      native.run.mockImplementation(async (_operation, { start }) =>
        failed
          ? {
              schemaVersion: "blocky.coding-failure/v1",
              requestId: start.requestId,
              projectId: start.projectId,
              baseDigest: result(start).baseDigest,
              code: "BLK-CODING-CANCELLED",
              changes: [change],
              modelApiCalled: true,
            }
          : { ...result(start), changes: [change] },
      );
      native.write.mockRejectedValue(Error("cannot publish artifact"));
      const reply = await codingCommand(
        parse([
          "coding",
          "run",
          "test.blocky",
          "--module",
          "research-agent",
          "--prompt",
          "test",
          "--output",
          "result.json",
        ]),
        new AbortController().signal,
      );
      const displayed = JSON.parse(output(reply!.result));
      expect(displayed.ok).toBe(false);
      expect(reply?.code).toBe(6);
      expect(displayed.data.receipt.changes[0].after).not.toBe(text);
      const chunks = displayed.data.receiptJsonBase64 as string[];
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((chunk) => chunk.length <= 12000)).toBe(true);
      const bytes = Buffer.from(chunks.join(""), "base64");
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        displayed.data.receiptSha256,
      );
      const recovered = JSON.parse(bytes.toString("utf8"));
      expect(recovered.changes[0]).toEqual(change);
      expect(recovered.schemaVersion).toBe(
        failed ? "blocky.coding-failure/v1" : "blocky.coding-result/v1",
      );
    },
  );
});
