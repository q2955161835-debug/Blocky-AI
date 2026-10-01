import { describe, expect, it, vi } from "vitest";
import {
  createTriggerClient,
  createTriggerReceiverClient,
  triggerRequestSchema,
  type TriggerRequest,
} from "../src/trigger-api";

const config = {
  schemaVersion: "blocky.trigger/v1" as const,
  triggerId: "timer-one",
  projectId: "project-one",
  moduleId: "main",
  exportId: "on-event",
  revision: 1,
  enabled: true,
  type: "timer" as const,
  schedule: {
    kind: "once" as const,
    startsAt: 1000,
    timeZone: "+08:00",
    misfire: "latest" as const,
  },
};

describe("typed trigger request client", () => {
  it("sends versioned durable claims and returns validated host records", async () => {
    const send = vi.fn(async (request: TriggerRequest) => {
      if (request.action === "claim")
        return {
          claimed: true,
          record: {
            projectId: "project-one",
            triggerId: "timer-one",
            configRevision: 1,
            moduleId: "main",
            exportId: "on-event",
            occurrenceId: "project-one:timer-one:r1:timer:1000",
            scheduledAt: 1000,
            kind: "timer",
            claimRevision: 1,
            status: "claimed",
          },
        };
      throw Error("unexpected action");
    });
    const client = createTriggerClient({
      projectId: "project-one",
      sessionId: "session-one",
      send,
      newRequestId: () => "request-one",
    });
    const claim = await client.claim(
      "timer-one",
      1,
      {
        occurrenceId: "project-one:timer-one:r1:timer:1000",
        scheduledAt: 1000,
        kind: "timer",
      },
      new AbortController().signal,
    );

    expect(claim.claimed).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: "blocky.trigger-request/v1",
        requestId: "request-one",
        projectId: "project-one",
        sessionId: "session-one",
        action: "claim",
        triggerId: "timer-one",
        expectedRevision: 1,
      }),
      expect.any(AbortSignal),
    );
  });

  it("keeps the occurrence settled when complete records the actual workflow task id", async () => {
    let sent: TriggerRequest | undefined;
    const send = vi.fn(async (request: TriggerRequest) => {
      sent = request;
      return {
        record: {
          projectId: "project-one",
          triggerId: "timer-one",
          configRevision: 1,
          moduleId: "main",
          exportId: "on-event",
          occurrenceId: "project-one:timer-one:r1:timer:1000",
          scheduledAt: 1000,
          kind: "timer",
          claimRevision: 2,
          status: "completed",
          workflowTaskId: "workflow-one",
        },
      };
    });
    const client = createTriggerClient({
      projectId: "project-one",
      sessionId: "session-one",
      send,
      newRequestId: () => "request-two",
    });
    const record = await client.complete(
      "timer-one",
      "project-one:timer-one:r1:timer:1000",
      1,
      { status: "completed", workflowTaskId: "workflow-one" },
    );

    expect(record.workflowTaskId).toBe("workflow-one");
    expect(sent?.action).toBe("complete");
    expect(sent && "workflowTaskId" in sent && sent.workflowTaskId).toBe(
      "workflow-one",
    );
  });

  it("rejects malformed requests and forged host responses", async () => {
    expect(
      triggerRequestSchema.safeParse({
        schemaVersion: "blocky.trigger-request/v1",
        requestId: "request-one",
        projectId: "project-one",
        sessionId: "session-one",
        action: "claim",
        triggerId: "timer-one",
        expectedRevision: null,
        occurrence: {
          occurrenceId: "project-one:timer-one:r1:timer:1000",
          scheduledAt: 1000,
          kind: "timer",
        },
      }).success,
    ).toBe(false);
    const client = createTriggerClient({
      projectId: "project-one",
      sessionId: "session-one",
      send: async () => ({ config: { ...config, projectId: "other-project" } }),
      newRequestId: () => "request-three",
    });
    await expect(
      client.upsert(config, null),
    ).rejects.toThrow("BLK-TRIGGER-RESPONSE");
  });
});

describe("external trigger receiver client", () => {
  it("accepts the complete bounded 128-event poll and binds every claim to the receiver", async () => {
    const events = Array.from({ length: 128 }, (_, index) => {
      const suffix = String(index + 1).padStart(3, "0");
      return {
        occurrence: {
          projectId: "project-one", triggerId: "external-one", configRevision: 1,
          moduleId: "main", exportId: "on-event",
          occurrenceId: `project-one:external-one:r1:external:event-${suffix}`,
          scheduledAt: 1000, kind: "external", eventId: `event-${suffix}`,
          claimRevision: 1, status: "claimed",
        },
        payload: { index },
      };
    });
    const send = vi.fn(async (request: { action: string }) => request.action === "start"
      ? { receiverId: "receiver-one", endpoint: "http://127.0.0.1:8080/events", configRevision: 1 }
      : { receiverId: "receiver-one", active: true, events });
    const client = createTriggerReceiverClient({ projectId: "project-one", sessionId: "session-one", send: send as never });
    await client.start("external-one", 1, "secret-ref-one");
    const polled = await client.poll("receiver-one");
    expect(polled.events).toHaveLength(128);
    expect(polled.events[127]?.occurrence.eventId).toBe("event-128");
  });

  it("rejects an oversized batch", async () => {
    const base = {
      projectId: "project-one", triggerId: "external-one", configRevision: 1,
      moduleId: "main", exportId: "on-event", occurrenceId: "project-one:external-one:r1:external:event-one",
      scheduledAt: 1000, kind: "external", eventId: "event-one", claimRevision: 1, status: "claimed",
    };
    const events = Array.from({ length: 129 }, (_, index) => ({ occurrence: { ...base, eventId: `event-${index}`, occurrenceId: `project-one:external-one:r1:external:event-${index}` }, payload: {} }));
    const send = vi.fn(async (request: { action: string }) => request.action === "start"
      ? { receiverId: "receiver-one", endpoint: "http://127.0.0.1:8080/events", configRevision: 1 }
      : { receiverId: "receiver-one", active: true, events });
    const client = createTriggerReceiverClient({ projectId: "project-one", sessionId: "session-one", send: send as never });
    await client.start("external-one", 1, "secret-ref-one");
    await expect(client.poll("receiver-one")).rejects.toThrow("BLK-TRIGGER-RESPONSE");
  });

  it("rejects a claim that does not match the receiver's trigger binding", async () => {
    const send = vi.fn(async (request: { action: string }) => request.action === "start"
      ? { receiverId: "receiver-one", endpoint: "http://127.0.0.1:8080/events", configRevision: 1 }
      : { receiverId: "receiver-one", active: true, events: [{
          occurrence: { projectId: "project-one", triggerId: "external-two", configRevision: 1,
            moduleId: "main", exportId: "on-event", occurrenceId: "project-one:external-two:r1:external:event-one",
            scheduledAt: 1000, kind: "external", eventId: "event-one", claimRevision: 1, status: "claimed" },
          payload: {},
        }] });
    const client = createTriggerReceiverClient({ projectId: "project-one", sessionId: "session-one", send: send as never });
    await client.start("external-one", 1, "secret-ref-one");
    await expect(client.poll("receiver-one")).rejects.toThrow("BLK-TRIGGER-BINDING");
  });
});
