import { expect, it } from "vitest";
import { BrowserPipe } from "../src/browser-wire";

it("rejects private protocol replays, invalid UTF-8, unknown fields and oversized frames without reflecting inputs", async () => {
  const pipe = new BrowserPipe();
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
  const frame = { schemaVersion: "blocky.browser-ipc/v1", requestId: 1, kind: "open", projectId: "p", url: "https://example.invalid/private-value" };
  const first = await pipe.receive(encode(frame));
  expect(first).toMatchObject({ ok: false, requestId: 1, code: "BLK-RPA-WIRE-001" });
  expect(JSON.stringify(first)).not.toContain("private-value");
  expect(await pipe.receive(encode(frame))).toMatchObject({ ok: false, requestId: 0 });
  expect(await pipe.receive(Buffer.from([0xff]))).toMatchObject({ ok: false, code: "BLK-RPA-WIRE-001" });
  expect(await pipe.receive(encode({ ...frame, requestId: 2, shell: "forbidden" }))).toMatchObject({ ok: false, requestId: 0 });
  await expect(pipe.receive(Buffer.alloc(65537))).rejects.toThrow("BLK-RPA-WIRE-001");
  await pipe.shutdown();
  await expect(pipe.receive(encode(frame))).rejects.toThrow("BLK-RPA-WIRE-001");
});
