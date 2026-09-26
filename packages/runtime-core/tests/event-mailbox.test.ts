import { expect, it } from "vitest";
import { EventMailbox } from "../src/event-mailbox";

it("keeps FIFO messages isolated by project and channel, with clone boundaries", async () => {
  const mailbox = new EventMailbox();
  const signal = new AbortController().signal;
  const value = { text: "first" };
  mailbox.send("project-a", "inbox", value, signal);
  value.text = "changed";
  mailbox.send("project-a", "inbox", "second", signal);
  expect(await mailbox.receive("project-b", "inbox", 0, signal)).toBeNull();
  expect(await mailbox.receive("project-a", "other", 0, signal)).toBeNull();
  expect(await mailbox.receive("project-a", "inbox", 0, signal)).toEqual({ payload: { text: "first" } });
  expect(await mailbox.receive("project-a", "inbox", 0, signal)).toEqual({ payload: "second" });
  expect(await mailbox.receive("project-a", "inbox", 0, signal)).toBeNull();
});

it("settles waits on send, timeout and cancellation without consuming future messages", async () => {
  const mailbox = new EventMailbox(), controller = new AbortController();
  const wait = mailbox.receive("project-a", "inbox", 1000, controller.signal);
  controller.abort();
  await expect(wait).rejects.toBeDefined();
  const signal = new AbortController().signal;
  const receive = mailbox.receive("project-a", "inbox", 1000, signal);
  mailbox.send("project-a", "inbox", null, signal);
  expect(await receive).toEqual({ payload: null });
  expect(await mailbox.receive("project-a", "inbox", 1, signal)).toBeNull();
  mailbox.send("project-a", "inbox", "kept", signal);
  await expect(mailbox.receive("project-a", "inbox", 0, controller.signal)).rejects.toBeDefined();
  expect(await mailbox.receive("project-a", "inbox", 0, signal)).toEqual({ payload: "kept" });
});

it("bounds payload and total queue capacity before mutating the mailbox", async () => {
  const mailbox = new EventMailbox(), signal = new AbortController().signal;
  expect(() => mailbox.send("project-a", "inbox", "中".repeat(6000), signal)).toThrow("BLK-EVENT-002");
  for (let i = 0; i < 128; i++) mailbox.send("project-a", "inbox", i, signal);
  expect(() => mailbox.send("project-a", "inbox", 129, signal)).toThrow("BLK-EVENT-002");
  expect(await mailbox.receive("project-a", "inbox", 0, signal)).toEqual({ payload: 0 });
  mailbox.send("project-a", "inbox", 129, signal);
  expect(() => mailbox.send("project-a", "../bad", "x", signal)).toThrow("BLK-EVENT-001");
  const bytes = new EventMailbox();
  for (let i = 0; i < 16; i++) bytes.send("project-a", "inbox", "x".repeat(15998), signal);
  expect(() => bytes.send("project-a", "inbox", "x".repeat(15998), signal)).toThrow("BLK-EVENT-002");
  await bytes.receive("project-a", "inbox", 0, signal);
  bytes.send("project-a", "inbox", "x".repeat(15998), signal);
});
