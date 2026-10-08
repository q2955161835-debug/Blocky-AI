// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { useChatFollow } from "../../apps/studio-desktop/src/app/useChatFollow";
import { ChatComposer } from "../../apps/studio-desktop/src/app/ChatComposer";
import { BlueprintDock } from "../../apps/studio-desktop/src/app/BlueprintDock";

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  notify() {
    this.callback([], this as unknown as ResizeObserver);
  }
  static notifyAll() {
    for (const observer of [...TestResizeObserver.instances]) observer.notify();
  }
}

beforeEach(() => {
  TestResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const height = this.classList.contains("chat-panel")
        ? 500
        : this.classList.contains("library")
          ? 600
          : 0;
      return {
        x: 0,
        y: 0,
        top: 0,
        right: 400,
        bottom: height,
        left: 0,
        width: 400,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("blueprint dock", () => {
  it("starts collapsed and exposes the complete dock through an accessible toggle", () => {
    render(
      <aside className="library">
        <div className="palette">调色板</div>
        <BlueprintDock>
          <button>个人蓝图</button>
          <button>导入蓝图</button>
          <button>项目画布</button>
          <button>内置起始蓝图</button>
        </BlueprintDock>
      </aside>,
    );

    const toggle = screen.getByRole("button", { name: "蓝图" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "个人蓝图" })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "个人蓝图" }).hidden).toBe(false);
    expect(screen.getByRole("button", { name: "内置起始蓝图" }).hidden).toBe(
      false,
    );
  });

  it("resizes upward, reserves palette space, and restores its manual height after collapsing", () => {
    render(
      <aside className="library">
        <div className="sidebar-heading">积木库</div>
        <div className="view-switch">专业</div>
        <div className="palette">调色板</div>
        <BlueprintDock>
          <button>个人蓝图</button>
        </BlueprintDock>
      </aside>,
    );

    const toggle = screen.getByRole("button", { name: "蓝图" });
    const dock = toggle.closest(".blueprint-dock") as HTMLElement;
    expect(dock.style.height).toBe("39px");
    fireEvent.click(toggle);

    const handle = screen.getByRole("separator", { name: "调整蓝图栏高度" });
    expect(handle.getAttribute("aria-valuenow")).toBe("200");
    expect(handle.getAttribute("aria-valuemax")).toBe("396");
    Object.defineProperty(handle, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(handle, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 240 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 240 });
    expect(handle.getAttribute("aria-valuenow")).toBe("260");
    expect(dock.style.height).toBe("260px");

    fireEvent.click(toggle);
    expect(dock.style.height).toBe("39px");
    expect(
      screen.queryByRole("separator", { name: "调整蓝图栏高度" }),
    ).toBeNull();
    fireEvent.click(toggle);
    expect(dock.style.height).toBe("260px");
    expect(
      screen
        .getByRole("separator", { name: "调整蓝图栏高度" })
        .getAttribute("aria-valuenow"),
    ).toBe("260");
  });
});

describe("chat composer", () => {
  it("submits through its form, forwards edits, and puts the toolbar inside the capped composer", () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <div className="chat-panel">
        <ChatComposer
          value=""
          onChange={onChange}
          onSubmit={onSubmit}
          onKeyDown={onKeyDown}
          label="构建助手输入"
          placeholder="描述要创建的内容"
          maxLength={1200}
        >
          <button type="button">工具</button>
        </ChatComposer>
      </div>,
    );

    const form = screen.getByRole("form", { name: "构建助手输入输入区" });
    const input = screen.getByRole("textbox", { name: "构建助手输入" });
    expect((form as HTMLFormElement).style.maxHeight).toBe("200px");
    expect(form.querySelector("button")?.textContent).toBe("工具");
    expect((input as HTMLTextAreaElement).maxLength).toBe(1200);
    expect((input as HTMLTextAreaElement).style.resize).toBe("none");

    fireEvent.change(input, { target: { value: "新问题" } });
    expect(onChange).toHaveBeenCalledWith("新问题");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onKeyDown).toHaveBeenCalled();
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("grows with content up to forty percent and keeps the manually chosen idle height", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <div className="chat-panel">
          <ChatComposer
            value={value}
            onChange={setValue}
            onSubmit={() => setValue("")}
            label="Blocky Agent 输入"
            placeholder="输入问题"
          >
            <button type="button">工具栏</button>
          </ChatComposer>
        </div>
      );
    }

    render(<Harness />);
    const form = screen.getByRole("form", { name: "Blocky Agent 输入输入区" });
    const input = screen.getByRole("textbox", { name: "Blocky Agent 输入" });
    const handle = screen.getByRole("separator", {
      name: "调整聊天输入框高度",
    });
    expect((form as HTMLFormElement).style.maxHeight).toBe("200px");

    fireEvent.keyDown(handle, { key: "ArrowUp" });
    const chosenHeight = Number(handle.getAttribute("aria-valuenow"));
    expect(chosenHeight).toBeGreaterThan(0);

    Object.defineProperty(input, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    fireEvent.change(input, { target: { value: "很多行\n".repeat(30) } });
    act(() => TestResizeObserver.notifyAll());
    expect((form as HTMLFormElement).style.height).toBe("200px");
    expect((form as HTMLFormElement).style.maxHeight).toBe("200px");

    fireEvent.submit(form);
    expect(handle.getAttribute("aria-valuenow")).toBe(String(chosenHeight));
  });

  it("restores measured input height and follows only a caret at the text end", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <div className="chat-panel">
          <ChatComposer
            value={value}
            onChange={setValue}
            onSubmit={() => {}}
            label="Blocky Agent 输入"
            placeholder="输入问题"
          >
            <button type="button">工具栏</button>
          </ChatComposer>
        </div>
      );
    }

    render(<Harness />);
    const input = screen.getByRole("textbox", {
      name: "Blocky Agent 输入",
    }) as HTMLTextAreaElement;
    Object.defineProperties(input, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 150 },
    });
    input.focus();

    const firstValue = "x".repeat(400);
    fireEvent.change(input, {
      target: {
        value: firstValue,
        selectionStart: firstValue.length,
        selectionEnd: firstValue.length,
      },
    });
    expect(input.style.height).toBe("155px");
    expect(input.scrollTop).toBe(600);

    input.scrollTop = 35;
    const secondValue = `${firstValue}y`;
    fireEvent.change(input, {
      target: {
        value: secondValue,
        selectionStart: secondValue.length,
        selectionEnd: secondValue.length,
      },
    });
    expect(input.style.height).toBe("155px");
    expect(input.scrollTop).toBe(600);

    input.scrollTop = 42;
    const middleValue = `${secondValue.slice(0, 2)}z${secondValue.slice(2)}`;
    fireEvent.change(input, {
      target: { value: middleValue, selectionStart: 3, selectionEnd: 3 },
    });
    expect(input.scrollTop).toBe(42);
  });
});

describe("chat follow", () => {
  function FollowFixture({
    resetKey,
    changeToken,
    onReady,
  }: {
    resetKey: string;
    changeToken: unknown;
    onReady(element: HTMLDivElement): void;
  }) {
    const follow = useChatFollow(resetKey, changeToken);
    return (
      <div
        data-testid="thread"
        ref={(element) => {
          follow.ref.current = element;
          if (element) onReady(element);
        }}
        onScroll={follow.onScroll}
      >
        <div>messages {String(changeToken)}</div>
      </div>
    );
  }

  function mountFollow(resetKey = "conversation-a", changeToken: unknown = 1) {
    let thread!: HTMLDivElement;
    const view = render(
      <FollowFixture
        resetKey={resetKey}
        changeToken={changeToken}
        onReady={(element) => {
          thread = element;
          Object.defineProperties(element, {
            clientHeight: { configurable: true, value: 100 },
            scrollHeight: { configurable: true, writable: true, value: 600 },
          });
        }}
      />,
    );
    return { view, thread };
  }

  function setScrollHeight(thread: HTMLDivElement, value: number) {
    Object.defineProperty(thread, "scrollHeight", {
      configurable: true,
      value,
    });
  }

  it("follows new output while pinned, pauses after manual scroll-up, and resumes at the bottom", () => {
    const { view, thread } = mountFollow();
    expect(thread.scrollTop).toBe(500);

    setScrollHeight(thread, 800);
    view.rerender(
      <FollowFixture
        resetKey="conversation-a"
        changeToken={2}
        onReady={() => {}}
      />,
    );
    expect(thread.scrollTop).toBe(700);

    thread.scrollTop = 100;
    fireEvent.scroll(thread);
    setScrollHeight(thread, 900);
    view.rerender(
      <FollowFixture
        resetKey="conversation-a"
        changeToken={3}
        onReady={() => {}}
      />,
    );
    expect(thread.scrollTop).toBe(100);

    thread.scrollTop = 780;
    fireEvent.scroll(thread);
    setScrollHeight(thread, 1000);
    view.rerender(
      <FollowFixture
        resetKey="conversation-a"
        changeToken={4}
        onReady={() => {}}
      />,
    );
    expect(thread.scrollTop).toBe(900);
  });

  it("jumps to the new conversation and follows delayed layout growth only when pinned", () => {
    const { view, thread } = mountFollow();
    thread.scrollTop = 75;
    fireEvent.scroll(thread);
    setScrollHeight(thread, 700);
    view.rerender(
      <FollowFixture
        resetKey="conversation-b"
        changeToken={1}
        onReady={() => {}}
      />,
    );
    expect(thread.scrollTop).toBe(600);

    setScrollHeight(thread, 850);
    act(() => TestResizeObserver.notifyAll());
    expect(thread.scrollTop).toBe(750);

    thread.scrollTop = 200;
    fireEvent.scroll(thread);
    setScrollHeight(thread, 1000);
    act(() => TestResizeObserver.notifyAll());
    expect(thread.scrollTop).toBe(200);
  });
});
