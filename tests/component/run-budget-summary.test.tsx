// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RunBudgetSummary } from "../../apps/studio-desktop/src/app/RunBudgetSummary";
import { createStarter } from "../../packages/test-fixtures/src";
import { createToolLoopScenario } from "../../packages/test-fixtures/src/scenarios/agent-tools";

afterEach(cleanup);

it("shows shared default run budgets when no budget block is configured", () => {
  render(<RunBudgetSummary project={createStarter()} />);
  fireEvent.click(screen.getByText("运行预算"));
  expect(
    screen.getByText(
      "未设置预算积木时默认：10000 步 · 256 次调用 · 1048576 输出 Token · 1800 秒",
    ),
  ).toBeTruthy();
});

it("shows configured budget block values and explains later blocks only tighten", () => {
  render(<RunBudgetSummary project={createToolLoopScenario("budget-summary")} />);
  fireEvent.click(screen.getByText("运行预算"));
  expect(screen.getByText("文本分析：100 步 · 8 次调用 · 2048 输出 Token · 120 秒")).toBeTruthy();
  expect(
    screen.getByText("首个预算积木设置运行上限；后续预算积木只能收紧上限。"),
  ).toBeTruthy();
});
