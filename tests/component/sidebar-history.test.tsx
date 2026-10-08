// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createStarter } from "../../packages/test-fixtures/src";
import {
  useStudio,
  type Studio,
} from "../../apps/studio-desktop/src/composition/useStudio";
import {
  useCodingAgent,
  type CodingAgent,
} from "../../apps/studio-desktop/src/composition/useCodingAgent";
import { StudioSidebar } from "../../apps/studio-desktop/src/app/StudioSidebar";
let studio: Studio, builder: CodingAgent;
function Harness() {
  studio = useStudio(createStarter());
  builder = useCodingAgent(studio);
  return (
    <StudioSidebar
      studio={studio}
      builder={builder}
      execute={() => {}}
      enabled={() => true}
      onTraceContext={() => {}}
    />
  );
}
afterEach(async () => {
  cleanup();
  await studio.settle();
  await studio.flush();
  await builder.flush();
  localStorage.clear();
});
it("keeps the header controls on one row and preserves searchable histories independently", async () => {
  const projectId = createStarter().manifest.projectId;
  localStorage.setItem(
    `blocky.coding-chat.${projectId}`,
    JSON.stringify({
      schemaVersion: "blocky.coding-chat/v1",
      projectId,
      messages: [
        { id: "old-builder", role: "user", text: "刑法条文搭建" },
        {
          id: "old-answer",
          role: "assistant",
          text: "## 搭建说明\n保存了原会话",
          status: "completed",
        },
      ],
    }),
  );
  const view = render(<Harness />);
  await waitFor(() =>
    expect(studio.agentChat.ready && builder.ready).toBe(true),
  );
  const header = view.container.querySelector(".chat-sidebar-header")!;
  expect(
    within(header as HTMLElement).getByRole("tab", { name: "Blocky Agent" }),
  ).toBeTruthy();
  expect(
    within(header as HTMLElement).getByRole("button", {
      name: "Blocky Agent 新会话",
    }),
  ).toBeTruthy();
  expect(view.container.querySelector(".chat-panel-header")).toBeNull();
  act(() =>
    studio.agentChat.update(projectId, () => [
      { id: "qa-user", role: "user", text: "交通肇事问答" },
      {
        id: "qa-answer",
        role: "assistant",
        text: "## 法条回答\n示例内容",
        status: "completed",
      },
    ]),
  );
  await act(() => studio.agentChat.flush());
  const oldAgent = studio.agentChat.activeId;
  fireEvent.click(screen.getByRole("button", { name: "Blocky Agent 新会话" }));
  await waitFor(() => expect(studio.agentChat.activeId).not.toBe(oldAgent));
  expect(screen.queryByRole("heading", { name: "法条回答" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Blocky Agent 历史会话" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "搜索历史会话" }), {
    target: { value: "交通" },
  });
  fireEvent.click(screen.getByRole("button", { name: /交通肇事问答/ }));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "法条回答" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("tab", { name: "构建助手" }));
  expect(screen.getByRole("heading", { name: "搭建说明" })).toBeTruthy();
  const oldBuilder = builder.activeChatId;
  fireEvent.click(screen.getByRole("button", { name: "构建助手新会话" }));
  await waitFor(() => expect(builder.activeChatId).not.toBe(oldBuilder));
  fireEvent.click(screen.getByRole("button", { name: "构建助手历史会话" }));
  fireEvent.click(screen.getByRole("button", { name: /刑法条文搭建/ }));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "搭建说明" })).toBeTruthy(),
  );
  expect(screen.queryByRole("heading", { name: "法条回答" })).toBeNull();
  expect(builder.result).toBeUndefined();
});
it("disables new conversation and history selection during an active run", async () => {
  const view = render(<Harness />);
  await waitFor(() =>
    expect(studio.agentChat.ready && builder.ready).toBe(true),
  );
  view.rerender(
    <StudioSidebar
      studio={{
        ...studio,
        running: true,
        session: { ...studio.session, rightView: "agent" },
      }}
      builder={builder}
      execute={() => {}}
      enabled={() => true}
      onTraceContext={() => {}}
    />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Blocky Agent 新会话",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Blocky Agent 历史会话" }),
  );
  expect(
    (
      within(screen.getByRole("dialog", { name: "历史会话" })).getByRole(
        "button",
        { name: /新会话/ },
      ) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
