import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
const spawned = vi.hoisted(() => ({ children: [] as any[] }));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr = { resume() {} };
    child.stdin = new EventEmitter();
    child.stdin.write = vi.fn((_part, callback) => {
      callback?.();
      return true;
    });
    child.stdin.end = () => queueMicrotask(() => child.emit("close"));
    child.kill = vi.fn(() => {
      queueMicrotask(() => child.emit("close"));
      return true;
    });
    spawned.children.push(child);
    return child;
  }),
}));
import { KnowledgeTransport } from "../../tools/blocky-cli/src/knowledge-transport";
beforeEach(() => {
  spawned.children.length = 0;
});
it("reads a large fragmented frame and rejects unsolicited trailing data", async () => {
  const transport = new KnowledgeTransport("helper.exe");
  const request = transport.request({ operation: "knowledge-load-index" });
  await Promise.resolve();
  const body = JSON.stringify({ value: "资料".repeat(2 * 1024 * 1024) });
  const child = spawned.children[0];
  for (let i = 0; i < body.length; i += 4096)
    child.stdout.emit("data", body.slice(i, i + 4096));
  child.stdout.emit("data", "\n");
  await expect(request).resolves.toEqual(JSON.parse(body));
  const next = transport.request({ operation: "knowledge-sources" });
  const rejected = expect(next).rejects.toMatchObject({ code: "BLK-HOST-001" });
  await Promise.resolve();
  await Promise.resolve();
  child.stdout.emit("data", '{}\n{"unsolicited":true}\n');
  await rejected;
  await transport.close();
});
it("cancels stalled inference and allows the queued ACL check on a fresh private process", async () => {
  const transport = new KnowledgeTransport("helper.exe");
  const pending = transport.request({ operation: "knowledge-vector-query" });
  const rejection = expect(pending).rejects.toMatchObject({
    code: "BLK-KNOW-CANCELLED",
  });
  await Promise.resolve();
  const check = transport.request({ operation: "knowledge-sources" });
  transport.cancel();
  await rejection;
  for (let i = 0; i < 8 && spawned.children.length < 2; i++)
    await Promise.resolve();
  expect(spawned.children[0].kill).toHaveBeenCalledOnce();
  expect(spawned.children).toHaveLength(2);
  // A late reply from the killed session must not settle the new request.
  spawned.children[0].stdout.emit("data", '{"value":"stale"}\n');
  spawned.children[1].stdout.emit("data", '{"value":"current-acl"}\n');
  await expect(check).resolves.toEqual({ value: "current-acl" });
  await transport.close();
});
