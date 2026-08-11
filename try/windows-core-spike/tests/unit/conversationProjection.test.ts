import { describe, expect, it } from "vitest";
import { createRuntimeEvent } from "../../src/core/runtimeEvents";
import {
  projectConversationTurns,
  type SubmittedRuntimeInput,
} from "../../src/runtime/conversationProjection";

describe("conversationProjection", () => {
  it("projects streamed model output into one friendly completed conversation turn", () => {
    const submissions: SubmittedRuntimeInput[] = [{
      runId: "desktop-run-1",
      entryId: "entry-1",
      userText: "明天上海天气怎么样？",
    }];
    const events = [
      createRuntimeEvent({ runId: "desktop-run-1", sequence: 1, type: "run.started" }),
      createRuntimeEvent({
        runId: "desktop-run-1",
        sequence: 2,
        type: "block.started",
        blockId: "block-001",
      }),
      createRuntimeEvent({
        runId: "desktop-run-1",
        sequence: 3,
        type: "model.chunk",
        blockId: "block-001",
        data: { text: "明天上海" },
      }),
      createRuntimeEvent({
        runId: "desktop-run-1",
        sequence: 4,
        type: "model.chunk",
        blockId: "block-001",
        data: { text: "天气晴朗。" },
      }),
      createRuntimeEvent({ runId: "desktop-run-1", sequence: 5, type: "run.completed" }),
    ];

    const [turn] = projectConversationTurns(
      submissions,
      events,
      { "block-001": "core.agent.define" },
    );
    expect(turn).toMatchObject({
      userText: "明天上海天气怎么样？",
      assistantText: "明天上海天气晴朗。",
      status: "completed",
    });
    expect(turn?.trace.map((item) => item.label)).toEqual([
      "开始处理",
      "进入 AI 伙伴",
      "生成回复",
      "生成回复",
      "处理完成",
    ]);
    expect(JSON.stringify(turn)).not.toMatch(/block-001|blocky\.event|"data"|PRIVATE_INTERNAL_CODE/);
  });

  it("uses fixed safe fallback messages for running, cancelled, and failed runs", () => {
    const submissions: SubmittedRuntimeInput[] = [
      { runId: "running", entryId: "entry", userText: "一" },
      { runId: "cancelled", entryId: "entry", userText: "二" },
      { runId: "failed", entryId: "entry", userText: "三" },
    ];
    const events = [
      createRuntimeEvent({ runId: "running", sequence: 1, type: "run.started" }),
      createRuntimeEvent({ runId: "cancelled", sequence: 1, type: "run.started" }),
      createRuntimeEvent({ runId: "cancelled", sequence: 2, type: "run.cancelled" }),
      createRuntimeEvent({ runId: "failed", sequence: 1, type: "run.started" }),
      createRuntimeEvent({
        runId: "failed",
        sequence: 2,
        type: "run.failed",
        data: { code: "PRIVATE_INTERNAL_CODE" },
      }),
    ];

    expect(projectConversationTurns(submissions, events, {}).map((turn) => ({
      status: turn.status,
      assistantText: turn.assistantText,
    }))).toEqual([
      { status: "running", assistantText: "正在处理…" },
      { status: "cancelled", assistantText: "运行已取消，可修改后重试。" },
      { status: "failed", assistantText: "运行失败，请检查积木后重试。" },
    ]);
  });
});
