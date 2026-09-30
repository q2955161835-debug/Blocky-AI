import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Resource } from "@blocky/language-schema";

type Configuration = Resource["definition"];
export type ManagedModelCall = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type Status = {
  modelId: string;
  installed: boolean;
  verified: boolean;
  loaded: boolean | null;
  busy: boolean;
  installedBytes?: number;
  backend?: string;
};
type Catalog = {
  backends: { id: string; downloadBytes: number }[];
  licenses: string[];
};
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readStatus(value: unknown, id: string): Status {
  if (
    !object(value) ||
    value.modelId !== id ||
    typeof value.installed !== "boolean" ||
    typeof value.verified !== "boolean" ||
    typeof value.busy !== "boolean" ||
    (typeof value.loaded !== "boolean" && value.loaded !== null) ||
    (value.installedBytes !== undefined &&
      (typeof value.installedBytes !== "number" ||
        !Number.isSafeInteger(value.installedBytes) ||
        value.installedBytes < 0)) ||
    (value.backend !== undefined &&
      !["cpu", "vulkan"].includes(String(value.backend)))
  )
    throw Error("BLK-LOCAL-MODEL-RESPONSE");
  return value as Status;
}
function readCatalog(value: unknown, id: string): Catalog {
  const model =
    object(value) && Array.isArray(value.models)
      ? value.models.find((m) => object(m) && m.modelId === id)
      : undefined;
  if (
    !object(model) ||
    !Array.isArray(model.backends) ||
    !Array.isArray(model.licenses) ||
    model.backends.some(
      (b) =>
        !object(b) ||
        !["cpu", "vulkan"].includes(String(b.id)) ||
        typeof b.downloadBytes !== "number" ||
        !Number.isSafeInteger(b.downloadBytes) ||
        b.downloadBytes < 0,
    ) ||
    model.licenses.some((l) => typeof l !== "string" || l.length > 128)
  )
    throw Error("BLK-LOCAL-MODEL-RESPONSE");
  return model as Catalog;
}
export function localRuntimeError(value: unknown): string {
  if (value === undefined) return "";
  if (!object(value) || !["cpu", "vulkan"].includes(String(value.backend)))
    return "请选择 CPU 或 Vulkan 后端。";
  if (
    value.backend === "vulkan" &&
    (typeof value.device !== "string" ||
      !/^Vulkan(?:[0-9]|1[0-5])$/.test(value.device))
  )
    return "请选择明确的 Vulkan 设备编号。";
  if (value.backend === "cpu" && value.device !== undefined)
    return "CPU 后端不能指定 Vulkan 设备。";
  for (const [key, label, min, max] of [
    ["contextTokens", "上下文 Token", 1024, 8192],
    ["threads", "CPU 线程", 1, 16],
    ["memoryMb", "内存上限", 2048, 32768],
  ] as const) {
    const n = value[key];
    if (
      n !== undefined &&
      (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max)
    )
      return `${label}须为 ${min}–${max} 的整数。`;
  }
  return "";
}
const hints: Record<string, string> = {
  "BLK-LOCAL-MODEL-HASH":
    "工件校验失败。停止相关运行后卸载并重新安装官方工件。",
  "BLK-LOCAL-MODEL-MISSING":
    "模型未安装。选择下载安装或导入匹配的模型和后端工件。",
  "BLK-LOCAL-MODEL-BUSY": "模型正被占用。停止相关运行，等待结算后刷新状态。",
  "BLK-LOCAL-MODEL-CANCELLED": "操作已停止，请刷新状态核对工件。",
  "BLK-LOCAL-MODEL-EXISTS":
    "已有安装。先校验；更换后端前停止运行并卸载原安装。",
  "BLK-LOCAL-MODEL-OWNERSHIP":
    "目录内容与清单不一致。保留现场，不要删除未知文件。",
  "BLK-LOCAL-MODEL-DOWNLOAD":
    "下载未完成。检查网络与磁盘空间，或导入官方工件重试。",
  "BLK-LOCAL-MODEL-PATH":
    "工件路径不符合安装边界。重新选择普通本地文件，避免链接。",
  "BLK-LOCAL-MODEL-UNSETTLED":
    "模型进程尚未完整结算。停止相关运行，暂时保留工件。",
  "BLK-PERM-001": "操作未获批准，请核对后重新发起。",
};
function safeError(error: unknown): string {
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  const code =
    text.match(/BLK-(?:LOCAL-MODEL-[A-Z-]+|PERM-001)/)?.[0] ??
    "BLK-LOCAL-MODEL-RESPONSE";
  return `${code}：${hints[code] ?? "操作结果未确认。检查资料目录权限与工件，刷新状态后再决定下一步。"}`;
}
const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

export function ManagedModelPanel({
  modelId,
  configuration,
  change,
  onBusyChange,
  call = invoke,
}: {
  modelId: string;
  configuration?: Configuration;
  change(value: Configuration): void;
  onBusyChange?(busy: boolean): void;
  call?: ManagedModelCall;
}) {
  const [status, setStatus] = useState<Status>(),
    [catalog, setCatalog] = useState<Catalog>(),
    [working, setWorking] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const epoch = useRef(0),
    active = useRef<string | undefined>(undefined),
    task = useRef(false),
    cancelling = useRef(false);
  const options = configuration ?? {},
    backend = options.backend === "vulkan" ? "vulkan" : "cpu";
  const locked = working || status?.busy === true;
  const configError = localRuntimeError(configuration);
  const catalogBackend = catalog?.backends.find((b) => b.id === backend);
  useEffect(() => {
    onBusyChange?.(locked);
  }, [locked, onBusyChange]);
  useEffect(() => {
    const current = ++epoch.current;
    task.current = true;
    setWorking(true);
    void Promise.allSettled([
      call("provider_local_model_catalog"),
      call("provider_local_model_status", { modelId }),
    ])
      .then(([list, snapshot]) => {
        if (current !== epoch.current) return;
        try {
          if (list.status === "fulfilled")
            setCatalog(readCatalog(list.value, modelId));
          else throw list.reason;
          if (snapshot.status === "fulfilled")
            setStatus(readStatus(snapshot.value, modelId));
          else throw snapshot.reason;
        } catch (e) {
          setError(safeError(e));
        }
      })
      .finally(() => {
        if (current === epoch.current) {
          task.current = false;
          setWorking(false);
        }
      });
    return () => {
      epoch.current++;
      if (active.current)
        void call("provider_cancel", { requestId: active.current }).catch(
          () => {},
        );
    };
  }, [modelId, call]);
  const execute = async (
    action: "refresh" | "install" | "verify" | "remove",
    importFiles = false,
  ) => {
    if (task.current) return;
    task.current = true;
    setWorking(true);
    setError("");
    setMessage("");
    cancelling.current = false;
    const current = epoch.current;
    const requestId = `model-${crypto.randomUUID()}`;
    active.current =
      action === "install" || action === "verify" ? requestId : undefined;
    try {
      let value: unknown;
      if (action === "refresh") {
        const [list, snapshot] = await Promise.all([
          call("provider_local_model_catalog"),
          call("provider_local_model_status", { modelId }),
        ]);
        if (current !== epoch.current) return;
        setCatalog(readCatalog(list, modelId));
        value = snapshot;
      } else if (action === "install")
        value = await call("provider_local_model_install", {
          modelId,
          backend,
          requestId,
          importFiles,
        });
      else if (action === "verify")
        value = await call("provider_local_model_verify", {
          modelId,
          requestId,
        });
      else {
        await call("provider_local_model_remove", { modelId });
        value = await call("provider_local_model_status", { modelId });
      }
      if (current !== epoch.current) return;
      const next = readStatus(value, modelId);
      setStatus(next);
      if (
        action === "install" &&
        (!next.installed || !next.verified || next.backend !== backend)
      )
        throw Error("BLK-LOCAL-MODEL-RESPONSE");
      if (action === "verify" && !next.verified)
        throw Error("BLK-LOCAL-MODEL-RESPONSE");
      if (action === "remove" && next.installed)
        throw Error("BLK-LOCAL-MODEL-RESPONSE");
      setMessage(
        action === "install"
          ? "安装完成"
          : action === "verify"
            ? "校验完成"
            : action === "remove"
              ? "卸载完成"
              : "状态已刷新",
      );
    } catch (e) {
      if (current === epoch.current) setError(safeError(e));
    } finally {
      if (current === epoch.current) {
        active.current = undefined;
        task.current = false;
        cancelling.current = false;
        setWorking(false);
      }
    }
  };
  const update = (patch: Configuration) => change({ ...options, ...patch });
  return (
    <section className="managed-model-panel" aria-label="本机托管模型">
      <h4>本机托管模型</h4>
      <fieldset disabled={locked}>
        <legend>运行配置</legend>
        <label>
          后端
          <select
            aria-label="本机后端"
            disabled={locked}
            value={backend}
            onChange={(e) => {
              const next: Configuration = {
                ...options,
                backend: e.target.value,
              };
              delete next.device;
              change(next);
            }}
          >
            <option value="cpu">CPU</option>
            <option value="vulkan">Vulkan</option>
          </select>
        </label>
        {backend === "vulkan" && (
          <label>
            设备
            <select
              aria-label="Vulkan 设备"
              disabled={locked}
              value={String(options.device ?? "")}
              onChange={(e) => update({ device: e.target.value })}
            >
              <option value="">选择设备编号</option>
              {Array.from({ length: 16 }, (_, n) => (
                <option key={n} value={`Vulkan${n}`}>{`Vulkan${n}`}</option>
              ))}
            </select>
          </label>
        )}
        {(
          [
            ["contextTokens", "上下文 Token", 1024, 8192, 8192],
            ["threads", "CPU 线程", 1, 16, 4],
            ["memoryMb", "内存上限（MiB）", 2048, 32768, 4096],
          ] as const
        ).map(([key, label, min, max, fallback]) => (
          <label key={key}>
            {label}
            <input
              aria-label={label}
              type="number"
              disabled={locked}
              min={min}
              max={max}
              step={1}
              value={String(options[key] ?? fallback)}
              onChange={(e) =>
                update({
                  [key]: e.target.value === "" ? 0 : Number(e.target.value),
                })
              }
            />
          </label>
        ))}
      </fieldset>
      {catalog && (
        <p>
          下载大小：
          {catalogBackend
            ? mib(catalogBackend.downloadBytes)
            : "未知，请刷新目录"}{" "}
          · 许可证：{catalog.licenses.join("、")}
        </p>
      )}
      {status && (
        <p>
          {status.busy
            ? "占用中，加载状态未确认"
            : status.installed
              ? "已安装"
              : "未安装"}
          {status.verified ? " · 已校验" : ""}
          {status.backend ? ` · ${status.backend}` : ""}
          {status.installedBytes !== undefined
            ? ` · 占用 ${mib(status.installedBytes)}`
            : ""}
        </p>
      )}
      <small>按请求加载，完成后退出。</small>
      {status?.installed && status.backend !== backend && (
        <p role="alert">
          安装后端与配置不一致。更换后端前停止运行并卸载原安装。
        </p>
      )}
      <div>
        <button disabled={working} onClick={() => void execute("refresh")}>
          刷新状态
        </button>
        <button
          disabled={locked || !catalog || status?.installed || !!configError}
          onClick={() => void execute("install")}
        >
          下载安装
        </button>
        <button
          disabled={locked || !catalog || status?.installed || !!configError}
          onClick={() => void execute("install", true)}
        >
          导入工件安装
        </button>
        <button
          disabled={locked || !status?.installed}
          onClick={() => void execute("verify")}
        >
          校验模型
        </button>
        <button
          disabled={locked || (!status?.installed && !error)}
          onClick={() => void execute("remove")}
        >
          卸载模型
        </button>
        {working && active.current && (
          <button
            disabled={cancelling.current}
            onClick={() => {
              if (!active.current || cancelling.current) return;
              const current = epoch.current,
                requestId = active.current;
              cancelling.current = true;
              setMessage("正在取消，请等待结算。");
              void call("provider_cancel", { requestId }).catch((e) => {
                if (current !== epoch.current || active.current !== requestId)
                  return;
                cancelling.current = false;
                setError(safeError(e));
              });
            }}
          >
            取消操作
          </button>
        )}
      </div>
      {working && <p role="status">{message || "正在处理，请等待…"}</p>}
      {!working && message && <p role="status">{message}</p>}
      {(error || configError) && <p role="alert">{error || configError}</p>}
    </section>
  );
}
