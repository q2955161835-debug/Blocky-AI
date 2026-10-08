// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { ResourcePanel } from "../../apps/studio-desktop/src/app/ResourcePanel";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
import { createStarter } from "../../packages/test-fixtures/src";
import { modelResource } from "../fixtures/model-resource";
const local = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock(
  "../../apps/studio-desktop/src/app/ManagedModelPanel",
  async (original) => {
    const actual =
      await original<
        typeof import("../../apps/studio-desktop/src/app/ManagedModelPanel")
      >();
    return {
      ...actual,
      ManagedModelPanel: function TestManagedPanel(
        props: ComponentProps<typeof actual.ManagedModelPanel>,
      ) {
        return <actual.ManagedModelPanel {...props} call={local.invoke} />;
      },
    };
  },
);

afterEach(cleanup);
function studio() {
  const upsert = vi.fn();
  const save = vi.fn(async () => true);
  const value = {
    snapshot: { project: createStarter() },
    resources: {
      ready: true,
      error: "",
      registry: { resources: [modelResource()] },
      map:new Map([[modelResource().resourceId,modelResource()]]),
      upsert,
    },
    controller: { edit: vi.fn() },
    rpaInput:{request:vi.fn()},
    confirm: vi.fn(),
    setMessage: vi.fn(),
    save,
  } as unknown as Studio;
  return { value, upsert, save };
}
it("saving a project resource also persists the current project file", async () => {
  const s = studio();
  render(<ResourcePanel studio={s.value} />);
  const resource = Object.values(s.value.snapshot.project.resources).find(r => r.kind === "model")!;
  fireEvent.click(screen.getByRole("button", { name: `${resource.displayName} · model` }));
  fireEvent.click(screen.getByRole("button", { name: "保存资源" }));
  await waitFor(() => expect(s.save).toHaveBeenCalledOnce());
  expect(s.value.controller.edit).toHaveBeenCalledOnce();
});

it("retains the draft and reports when project configuration cannot reach disk", async () => {
  const s = studio();
  s.save.mockResolvedValue(false);
  render(<ResourcePanel studio={s.value} />);
  const resource = Object.values(s.value.snapshot.project.resources).find(r => r.kind === "model")!;
  fireEvent.click(screen.getByRole("button", { name: `${resource.displayName} · model` }));
  fireEvent.click(screen.getByRole("button", { name: "保存资源" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("项目文件"));
  expect(screen.getByRole("button", { name: "保存资源" })).toBeTruthy();
});
it("edits a saved model through the ordinary form, preserves secrets and retains advanced configuration", () => {
  const s = studio();
  render(<ResourcePanel studio={s.value} />);
  fireEvent.change(screen.getByLabelText("资源范围"), {
    target: { value: "user" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Saved online model · model" }),
  );
  expect(screen.getByText("资源高级配置")).toBeTruthy();
  expect(
    (screen.getByLabelText("apiKey秘密引用") as HTMLInputElement).value,
  ).toBe("saved-model-secret");
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "selected-model" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存资源" }));
  expect(s.upsert).toHaveBeenCalledOnce();
  expect(s.upsert.mock.calls[0][0]).toMatchObject({
    definition: { modelId: "selected-model" },
    secretBindings: modelResource().secretBindings,
  });
});

it("shows a usable creation form and disables saving until required references exist", () => {
  const s = studio();
  render(<ResourcePanel studio={s.value} />);
  fireEvent.click(screen.getByRole("button", { name: "新建资源" }));
  fireEvent.change(screen.getByLabelText("模型服务类型"), {
    target: { value: "openai-compatible" },
  });
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "custom-model" },
  });
  expect(
    (screen.getByRole("button", { name: "保存资源" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("baseUrl");
  expect(screen.queryByLabelText("启用 definition.baseUrl")).toBeNull();
  fireEvent.change(screen.getByLabelText("baseUrl秘密引用"), {
    target: { value: "custom-url-ref" },
  });
  expect(
    (screen.getByRole("button", { name: "保存资源" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it("keeps the deterministic legacy model editor entrance", () => {
  const s = studio();
  render(<ResourcePanel studio={s.value} />);
  const legacy = Object.values(s.value.snapshot.project.resources).find(
    (r) => r.kind === "model",
  )!;
  fireEvent.click(
    screen.getByRole("button", { name: `${legacy.displayName} · model` }),
  );
  expect(screen.getByText("此资源使用本地确定性适配器。")).toBeTruthy();
  expect(screen.queryByLabelText("模型服务类型")).toBeNull();
});

it("locks advanced fields, saving and resource cancellation while keeping managed request cancellation", async () => {
  const modelId = "qwen3-0.6b-q8-v1";
  const status = {
    modelId,
    installed: false,
    verified: false,
    loaded: false,
    busy: false,
  };
  let reject!: (e: unknown) => void;
  local.invoke.mockImplementation(async (command) =>
    command === "provider_local_model_catalog"
      ? {
          models: [
            {
              modelId,
              backends: [
                { id: "cpu", downloadBytes: 1 },
                { id: "vulkan", downloadBytes: 1 },
              ],
              licenses: ["MIT"],
            },
          ],
        }
      : command === "provider_local_model_install"
        ? new Promise((_, fail) => {
            reject = fail;
          })
        : status,
  );
  const s = studio();
  render(<ResourcePanel studio={s.value} />);
  fireEvent.click(screen.getByRole("button", { name: "新建资源" }));
  fireEvent.change(screen.getByLabelText("模型服务类型"), {
    target: { value: "managed-local" },
  });
  await screen.findByText("未安装");
  expect(
    (screen.getByLabelText("上下文 Token") as HTMLInputElement).value,
  ).toBe("8192");
  fireEvent.click(screen.getByRole("button", { name: "下载安装" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "保存资源" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  expect(
    (
      screen.getByRole("button", {
        name: "取消",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    screen.getByLabelText("definition.timeoutMs").matches(":disabled"),
  ).toBe(true);
  expect((screen.getByLabelText("资源名称") as HTMLInputElement).disabled).toBe(
    true,
  );
  expect(
    (screen.getByRole("button", { name: "取消操作" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "取消操作" }));
  await act(async () => reject("BLK-LOCAL-MODEL-CANCELLED"));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "取消",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
});
