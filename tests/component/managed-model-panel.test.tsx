// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { ManagedModelPanel } from "../../apps/studio-desktop/src/app/ManagedModelPanel";
import type { Resource } from "../../packages/language-schema/src";
const io = vi.hoisted(() => ({ invoke: vi.fn() }));
const id = "qwen3-0.6b-q8-v1";
const status = {
  modelId: id,
  installed: false,
  verified: false,
  loaded: false,
  busy: false,
};
const catalog = {
  models: [
    {
      modelId: id,
      backends: [
        { id: "cpu", downloadBytes: 660000000 },
        { id: "vulkan", downloadBytes: 680000000 },
      ],
      licenses: ["MIT", "Apache-2.0", "LLVM OpenMP"],
    },
  ],
};
beforeEach(() => {
  io.invoke.mockReset();
  io.invoke.mockImplementation(async (command: string) =>
    command === "provider_local_model_catalog" ? catalog : status,
  );
});
afterEach(cleanup);
function Panel() {
  const [value, change] = useState<Resource["definition"]>({
    backend: "cpu",
    contextTokens: 4096,
    threads: 4,
    memoryMb: 4096,
  });
  return (
    <>
      <ManagedModelPanel
        modelId={id}
        configuration={value}
        change={change}
        call={io.invoke}
      />
      <output data-testid="config">{JSON.stringify(value)}</output>
    </>
  );
}
async function open() {
  render(<Panel />);
  await screen.findByText("未安装");
}
it("reads status and catalog without claiming a permanently loaded model", async () => {
  await open();
  expect(screen.getByText(/629.4 MiB/)).toBeTruthy();
  expect(screen.getByText(/Apache-2.0/)).toBeTruthy();
  expect(io.invoke).toHaveBeenCalledWith("provider_local_model_status", {
    modelId: id,
  });
  expect(screen.queryByText("已加载常驻")).toBeNull();
});
it("requires an explicit Vulkan device and updates bounded runtime settings", async () => {
  await open();
  fireEvent.change(screen.getByLabelText("本机后端"), {
    target: { value: "vulkan" },
  });
  expect(screen.getByRole("alert").textContent).toContain("Vulkan");
  fireEvent.change(screen.getByLabelText("Vulkan 设备"), {
    target: { value: "Vulkan1" },
  });
  fireEvent.change(screen.getByLabelText("上下文 Token"), {
    target: { value: "8192" },
  });
  expect(JSON.parse(screen.getByTestId("config").textContent!)).toMatchObject({
    backend: "vulkan",
    device: "Vulkan1",
    contextTokens: 8192,
  });
  fireEvent.change(screen.getByLabelText("CPU 线程"), {
    target: { value: "17" },
  });
  expect(screen.getByRole("alert").textContent).toContain("线程");
});
it.each([false, true])(
  "requests a Host-owned %s installation without path inputs",
  async (importFiles) => {
    await open();
    io.invoke.mockImplementation(async (command) =>
      command === "provider_local_model_install"
        ? {
            ...status,
            installed: true,
            verified: true,
            backend: "cpu",
            installedBytes: 700000000,
          }
        : command === "provider_local_model_status"
          ? {
              ...status,
              installed: true,
              verified: true,
              backend: "cpu",
              installedBytes: 700000000,
            }
          : catalog,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: importFiles ? "导入工件安装" : "下载安装",
      }),
    );
    await screen.findByText("安装完成");
    const args = io.invoke.mock.calls.find(
      ([command]) => command === "provider_local_model_install",
    )![1];
    expect(args).toMatchObject({ modelId: id, backend: "cpu", importFiles });
    expect(args.requestId).toMatch(/^model-/);
    expect(args).not.toHaveProperty("modelFile");
    expect(screen.queryByLabelText("模型文件路径")).toBeNull();
  },
);
it("locks configuration during work and cancels only the current request", async () => {
  await open();
  let reject!: (error: unknown) => void;
  io.invoke.mockImplementation((command: string) =>
    command === "provider_local_model_install"
      ? new Promise((_, fail) => {
          reject = fail;
        })
      : Promise.resolve(status),
  );
  fireEvent.click(screen.getByRole("button", { name: "下载安装" }));
  expect(
    (screen.getByLabelText("本机后端") as HTMLSelectElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "取消操作" }));
  await waitFor(() =>
    expect(io.invoke).toHaveBeenCalledWith("provider_cancel", {
      requestId: expect.any(String),
    }),
  );
  await act(async () => reject("BLK-LOCAL-MODEL-CANCELLED"));
  await screen.findByText(/已停止/);
  expect(
    (screen.getByLabelText("本机后端") as HTMLSelectElement).disabled,
  ).toBe(false);
});
it("reports busy unknown loading state and allows status refresh", async () => {
  io.invoke.mockImplementation(async (command) =>
    command === "provider_local_model_catalog"
      ? catalog
      : {
          ...status,
          installed: true,
          busy: true,
          loaded: null,
          backend: "cpu",
        },
  );
  render(<Panel />);
  await screen.findByText(/加载状态未确认/);
  expect(
    (screen.getByRole("button", { name: "卸载模型" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((screen.getByLabelText("CPU 线程") as HTMLInputElement).disabled).toBe(
    true,
  );
  expect(
    (screen.getByRole("button", { name: "刷新状态" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});
it("shows safe recovery guidance without echoing native errors", async () => {
  await open();
  io.invoke.mockRejectedValue("private-canary C:\\secret BLK-LOCAL-MODEL-HASH");
  fireEvent.click(screen.getByRole("button", { name: "下载安装" }));
  await screen.findByText(/BLK-LOCAL-MODEL-HASH/);
  expect(screen.getByRole("alert").textContent).toContain("重新安装");
  expect(screen.getByRole("alert").textContent).not.toContain("private-canary");
});

it("verifies installed artifacts and reads status after Host-approved removal", async () => {
  io.invoke.mockImplementation(async (command) =>
    command === "provider_local_model_catalog"
      ? catalog
      : { ...status, installed: true, backend: "cpu" },
  );
  render(<Panel />);
  await screen.findByText(/已安装/);
  io.invoke.mockImplementation(async (command) =>
    command === "provider_local_model_verify"
      ? { ...status, installed: true, verified: true, backend: "cpu" }
      : status,
  );
  fireEvent.click(screen.getByRole("button", { name: "校验模型" }));
  await screen.findByText("校验完成");
  expect(io.invoke).toHaveBeenCalledWith("provider_local_model_verify", {
    modelId: id,
    requestId: expect.any(String),
  });
  fireEvent.click(screen.getByRole("button", { name: "卸载模型" }));
  await screen.findByText("卸载完成");
  expect(io.invoke).toHaveBeenCalledWith("provider_local_model_remove", {
    modelId: id,
  });
  expect(screen.getByText("未安装")).toBeTruthy();
});

it("retains a removal recovery entry after damaged status fails", async () => {
  io.invoke.mockImplementation(async (command) => {
    if (command === "provider_local_model_catalog") return catalog;
    throw "BLK-LOCAL-MODEL-OWNERSHIP";
  });
  render(<Panel />);
  await screen.findByText(/BLK-LOCAL-MODEL-OWNERSHIP/);
  expect(
    (screen.getByRole("button", { name: "卸载模型" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  io.invoke.mockResolvedValue(status);
  fireEvent.click(screen.getByRole("button", { name: "卸载模型" }));
  await screen.findByText("卸载完成");
});

it("does not claim installation when its native receipt belongs to another model", async () => {
  await open();
  io.invoke.mockResolvedValue({
    ...status,
    modelId: "other-model",
    installed: true,
    verified: true,
    backend: "cpu",
  });
  fireEvent.click(screen.getByRole("button", { name: "下载安装" }));
  await screen.findByText(/BLK-LOCAL-MODEL-RESPONSE/);
  expect(screen.queryByText("安装完成")).toBeNull();
});
