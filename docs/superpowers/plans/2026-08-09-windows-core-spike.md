# Windows Core 技术尖峰 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在可删除的 `try/windows-core-spike/` 中完成一个 Windows 原生 Tauri 技术尖峰，用可重复测试证明 Blockly 本地加载、100 积木编辑与保存、稳定 IR、`InteractionManifest` 驱动的右侧通用输入栏、一等 Tool 契约、模拟流式运行、取消/错误/权限事件和安全 Host 边界可行。

**Architecture:** 尖峰采用单个 Tauri 2 + React + TypeScript + Blockly 工程，但把 Blockly 适配、纯 TypeScript 语义内核、React 投影、Tauri Host 四层分开。Blockly JSON 是编辑状态，稳定 IR 是运行输入，`InteractionManifest` 是右侧输入栏唯一读取的编译产物；Rust Host 只接受受限项目 ID 和经过校验的 JSON，不接受前端传入任意文件路径。尖峰项目使用明确标记的 `blocky.spike-project/v1` JSON 快照，不提前锁定正式 `.blocky` 压缩容器。

**Tech Stack:** Windows 11、Node.js 22.23.1、pnpm 10.23.0、Rust 1.95.0、Tauri CLI 2.11.4 / crate 2.11.5、React 19.2.8、TypeScript 7.0.2、Vite 8.2.1、Blockly 13.2.1、Vitest 4.1.10、Testing Library、WebdriverIO 9 + `@wdio/tauri-service` 1.3.0。

## Global Constraints

- 只实现 ADR-001 第一阶段 Windows Core 八项门禁；不实现正式产品骨架、账号、订阅、权益、社区、CLI、官方 Skills、真实模型、真实插件、自定义积木、macOS、移动端或四类原生 Agent 适配器。
- `搭建助手` 标签只提供静态尖峰说明，不连接模型、不接受输入，也不冒充完整搭建助手；真实审阅模式和直接搭建模式属于 Windows 第二阶段。
- `运行 Agent` 是用户作品的通用交互入口。没有有效 `core.interaction.chat_entry` 时整个标签禁用；文本、图片、文件、语音、Skill、插件动作只由 `InteractionManifest` 解锁，组件禁止扫描 Blockly 工作区自行猜测。
- 聊天入口积木内部不得出现输入框或发送按钮；测试输入与真实运行输入都只通过右侧 `运行 Agent` 标签发送。
- 工具定义、工具引用、Agent 自主可见工具和显式工具调用必须通过同一稳定 `toolId` 解析到同一 `ToolContract`；尖峰不复制或内嵌第二份工具 Schema。
- Blockly 和所有前端资源必须由安装包本地加载；运行时代码不得访问 CDN 或远程站点。CSP 默认拒绝远程脚本、样式和连接。
- WebView 不保存密钥、Token、Cookie、任意绝对路径或长期凭据。尖峰没有真实凭据配置；测试秘密只在运行时由字符串片段拼出，禁止以完整值提交到仓库。
- WDIO Rust/前端插件只在 `wdio` 测试构建启用。普通 release 构建不得包含 `wdio:default` 权限、全局 Tauri API 或测试插件。
- 尖峰 UI 使用简体中文固定文案；简体中文、繁体中文、英语、日语完整本地化属于第一个正式 Windows 开发版，不把临时尖峰当成该版本。
- 不创建或修改项目 `AGENTS.md`，除非用户另行明确授权。
- 每个任务遵循 RED → GREEN → REFACTOR；每次提交前运行该任务列出的测试。禁止用跳过测试、放宽断言或伪造指标换取绿色。
- 若连续三次仍无法实现同一目标，按项目规则先查官方文档与技术社区，记录失败证据后再改变方案。
- 完整 30 分钟 soak 是 L3 Core 验收必需项；快速测试通过不能替代它。

---

## Frozen Spike Contracts

以下契约在尖峰内先冻结，任务之间不得另造同义类型。它们是临时 `v0-spike`/`v1` 契约，尖峰通过后仍需在正式共享包中重新评审版本号。

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface IrNode {
  id: string;
  type: string;
  fields: Record<string, JsonValue>;
  inputs: Record<string, IrNode | null>;
  next: IrNode | null;
}

export interface BlockyProgram {
  schemaVersion: "blocky.ir/v0-spike";
  roots: IrNode[];
}

export type InputPartKind = "text" | "image" | "file" | "voice";

export interface InteractionEntry {
  id: string;
  ownerAgentId: string;
  displayName: string;
  acceptedParts: InputPartKind[];
  exposedSkills: string[];
  exposedPluginActions: string[];
  executionRequirements: string[];
}

export interface InteractionManifest {
  schemaVersion: "blocky.interaction/v0-spike";
  entries: InteractionEntry[];
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, { type: "string" | "number" | "boolean" }>;
  required: string[];
  additionalProperties: false;
}

export interface ToolContract {
  id: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permissions: string[];
  requiresApproval: boolean;
  implementation: { kind: "mock"; result: JsonValue };
}

export interface ToolCall {
  callBlockId: string;
  toolId: string;
  args: Record<string, JsonValue>;
}

export interface SpikeProjectSnapshot {
  schemaVersion: "blocky.spike-project/v1";
  projectId: string;
  workspace: JsonValue;
  program: BlockyProgram;
  interactionManifest: InteractionManifest;
}

export interface SaveProjectRequest {
  projectId: string;
  json: string;
}

export interface ProjectRecord {
  projectId: string;
  bytes: number;
  sha256: string;
  json: string;
}
```

运行事件统一使用稳定版本、单调递增序号和可选积木 ID：

```ts
export type RuntimeEventType =
  | "run.started"
  | "block.started"
  | "model.chunk"
  | "tool.permission_requested"
  | "tool.started"
  | "tool.completed"
  | "block.completed"
  | "run.completed"
  | "run.cancelled"
  | "run.failed";

export interface RuntimeEvent {
  eventVersion: "blocky.event/v0-spike";
  runId: string;
  sequence: number;
  type: RuntimeEventType;
  blockId?: string;
  data: Record<string, JsonValue>;
}
```

## Acceptance Matrix

| ADR-001 Windows Core 门禁 | 自动化证据 | 人工证据 |
|---|---|---|
| 本地加载 Blockly | `tests/e2e/windows-core.e2e.ts` 断网启动；构建产物 URL 扫描 | 关闭网络后启动 release 并打开工具箱 |
| 不少于 100 积木创建、连接、折叠、缩放、保存 | `tests/unit/fixture.test.ts` 精确 100；原生 E2E 保存重开 | 拖动、连接、折叠、缩放各至少一次 |
| 工作区编译稳定 IR，事件映射画布 | `compiler.test.ts`、`runtime.test.ts`、E2E 高亮断言 | 运行时观察当前积木高亮与事件列表一致 |
| 双标签；无入口禁用运行标签 | `App.test.tsx`、原生 E2E | 删除最后入口后确认禁用与定位提示 |
| 入口能力按 `InteractionManifest` 同步 | `interactionManifest.test.ts`、`RuntimeComposer.test.tsx` | 增删六种能力并切换两个入口 |
| Tool 引用和显式调用共享契约 | `toolContract.test.ts`、`runtime.test.ts` | 修改 Tool 名称/参数后观察两处同步 |
| 模拟流、取消、错误、权限请求 | `runtime.test.ts`、原生 E2E | 正常、`/error`、`/permission`、取消各运行一次 |
| 项目与日志敏感信息扫描为零 | `securityScan.test.ts`、Rust Host 测试、验收扫描 | 查看测试日志与项目 JSON 无明文秘密/绝对路径 |

## File and Responsibility Map

| Area | Files | Single responsibility |
|---|---|---|
| Spike configuration | `try/windows-core-spike/package.json`, `vite.config.ts`, `vitest.config.ts`, `wdio.conf.ts` | Pin the disposable spike toolchain and expose repeatable commands |
| Blockly adapter | `src/blockly/catalog.ts`, `connectionGrammar.ts`, `definitions.ts`, `fixtures.ts`, `workspaceAdapter.ts`, `BlocklyCanvas.tsx`, `toolbox.ts` | Own Blockly-specific registration, connections, local toolbox, JSON and canvas lifecycle |
| Pure semantic core | `src/core/json.ts`, `ir.ts`, `diagnostics.ts`, `compileWorkspace.ts`, `interactionManifest.ts`, `toolContract.ts`, `runtimeEvents.ts`, `deterministicRuntime.ts`, `securityScan.ts` | Compile and run versioned semantics without importing Blockly, React or Tauri |
| React projection | `src/app/*`, `src/runtime/*`, `src/builder/BuilderPlaceholder.tsx` | Render editor state, two isolated right tabs, manifest-driven composer and runtime events |
| Project boundary | `src/project/SpikeProjectSnapshot.ts`, `src/host/*` | Create deterministic spike snapshots and abstract storage from the UI |
| Native Host | `src-tauri/src/project_store.rs`, `src-tauri/src/lib.rs`, Tauri configs/capabilities | Validate, atomically persist and reload project JSON inside app data |
| Verification | `tests/unit/*`, `tests/component/*`, `tests/e2e/*`, `tests/security/*`, `scripts/verify-spike.ps1` | Prove semantic, UI, native, performance, soak and secret-safety contracts |
| Evidence | `doc/技术设计/Windows-Core技术尖峰报告.md`, `doc/验收/*`, `doc/进展记录/*` | Record measured facts, decision, acceptance and rollback/merge state |

### Task 0: 建立实施分支和可回退检查点

**Files:**

- Verify only: `.git/`, `scripts/check-dev-environment.ps1`
- Do not modify: `AGENTS.md`

**Interfaces:**

- Consumes: 已合并本计划的干净本地 `main`，以及 `scripts/check-dev-environment.ps1 -Json` 的 26 项环境契约。
- Produces: `codex/feat-windows-core-spike` 分支与一个可回退的空检查点提交；后续所有任务只在该分支执行。

- [ ] **Step 1: 确认从已合并计划的干净 `main` 开始**

Run:

```powershell
git switch main
git status --short --branch
git log -1 --oneline
```

Expected: 只显示 `## main` 或 `## main...origin/main [ahead N]`，没有文件级输出。若有用户改动，停止并先区分来源，不得覆盖。

- [ ] **Step 2: 复核 Windows 工具链**

Run:

```powershell
pwsh -NoProfile -File .\scripts\check-dev-environment.ps1 -Json
```

Expected: `checks` 共 26 项且全部 `passed: true`。任何缺失依赖必须修复或明确阻塞，不能静默跳过。

- [ ] **Step 3: 创建复杂任务分支和检查点**

Run:

```powershell
git switch -c codex/feat-windows-core-spike
git commit --allow-empty -m "chore: checkpoint before Windows Core spike"
```

Expected: 当前分支为 `codex/feat-windows-core-spike`，检查点提交成功。

### Task 1: 建立隔离的 Tauri/React/Blockly 尖峰与测试骨架

**Files:**

- Modify: `.gitignore`
- Create: `try/windows-core-spike/package.json`
- Create: `try/windows-core-spike/pnpm-lock.yaml`
- Create: `try/windows-core-spike/index.html`
- Create: `try/windows-core-spike/tsconfig.json`
- Create: `try/windows-core-spike/tsconfig.app.json`
- Create: `try/windows-core-spike/tsconfig.node.json`
- Create: `try/windows-core-spike/vite.config.ts`
- Create: `try/windows-core-spike/vitest.config.ts`
- Create: `try/windows-core-spike/src/main.tsx`
- Create: `try/windows-core-spike/src/test/setup.ts`
- Create: `try/windows-core-spike/tests/unit/spikeScope.test.ts`
- Create: `try/windows-core-spike/src/core/spikeScope.ts`
- Create: `try/windows-core-spike/src-tauri/Cargo.toml`
- Create: `try/windows-core-spike/src-tauri/Cargo.lock`
- Create: `try/windows-core-spike/src-tauri/build.rs`
- Create: `try/windows-core-spike/src-tauri/src/main.rs`
- Create: `try/windows-core-spike/src-tauri/src/lib.rs`
- Create: `try/windows-core-spike/src-tauri/tauri.conf.json`
- Create: `try/windows-core-spike/src-tauri/capabilities/main.json`

**Interfaces:**

- Consumes: Task 0 的任务分支、已验证 Node/pnpm/Rust/Tauri Windows 工具链。
- Produces: 可构建的 `try/windows-core-spike/` 工程、`SPIKE_SCOPE` 常量、Vitest/Rust 测试入口和默认无 WDIO 权限的 Tauri 壳。

- [ ] **Step 1: 让 Git 只跟踪该尖峰源码，不跟踪生成物**

Modify `.gitignore` to replace the final `try/` block with:

```gitignore
# Temporary experiments are ignored unless explicitly admitted below
try/*
!try/windows-core-spike/
!try/windows-core-spike/**
try/windows-core-spike/node_modules/
try/windows-core-spike/dist/
try/windows-core-spike/coverage/
try/windows-core-spike/test-results/
try/windows-core-spike/artifacts/
try/windows-core-spike/src-tauri/target/
```

Run:

```powershell
git check-ignore -v try/windows-core-spike/node_modules/example.txt
git check-ignore -v try/windows-core-spike/src/core/spikeScope.ts
```

Expected: 第一条命中忽略规则；第二条无输出且退出码为 1，表示源码可跟踪。

- [ ] **Step 2: 生成本地 Tauri React TypeScript 工程**

Run from repository root:

```powershell
pnpm create tauri-app@4.6.2 try/windows-core-spike --manager pnpm --template react-ts --identifier ai.blocky.windowscorespike --yes
```

Expected: 只在 `try/windows-core-spike/` 生成工程。若 CLI 参数与当前版本不匹配，先运行 `pnpm create tauri-app@4.6.2 --help`，按 4.6.2 的等价非交互参数重试，并在进展记录写明差异。

- [ ] **Step 3: 锁定依赖，禁止范围版本漂移**

Replace `package.json` dependency declarations with exact versions and the following scripts:

```json
{
  "name": "blocky-windows-core-spike",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "build:wdio": "tsc -b && vite build --mode wdio",
    "tauri": "tauri",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:component": "vitest run tests/component",
    "test:e2e:build": "tauri build --no-bundle --features wdio --config src-tauri/tauri.wdio.conf.json",
    "test:e2e": "wdio run ./wdio.conf.ts --spec ./tests/e2e/windows-core.e2e.ts",
    "test:soak": "wdio run ./wdio.conf.ts --spec ./tests/e2e/windows-core-soak.e2e.ts",
    "check": "vitest run"
  },
  "dependencies": {
    "@tauri-apps/api": "2.11.1",
    "blockly": "13.2.1",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@tauri-apps/cli": "2.11.4",
    "@testing-library/jest-dom": "7.0.0",
    "@testing-library/react": "16.3.2",
    "@testing-library/user-event": "14.6.3",
    "@types/node": "22.20.1",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.4",
    "@vitejs/plugin-react": "6.0.5",
    "@wdio/cli": "9.30.1",
    "@wdio/globals": "9.29.1",
    "@wdio/local-runner": "9.30.1",
    "@wdio/mocha-framework": "9.30.1",
    "@wdio/spec-reporter": "9.30.1",
    "@wdio/tauri-plugin": "1.3.0",
    "@wdio/tauri-service": "1.3.0",
    "jsdom": "30.0.1",
    "typescript": "7.0.2",
    "vite": "8.2.1",
    "vitest": "4.1.10"
  }
}
```

Run:

```powershell
pnpm --dir try/windows-core-spike install --save-exact
pnpm --dir try/windows-core-spike install --frozen-lockfile
```

Expected: `pnpm-lock.yaml` 生成，第二条命令不修改锁文件。

- [ ] **Step 4: 写第一个失败的 TypeScript 契约测试**

Create `tests/unit/spikeScope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SPIKE_SCOPE } from "../../src/core/spikeScope";

describe("SPIKE_SCOPE", () => {
  it("keeps product features outside the disposable core spike", () => {
    expect(SPIKE_SCOPE.included).toEqual([
      "blockly-editor",
      "stable-ir",
      "interaction-manifest",
      "tool-contract",
      "deterministic-runtime",
      "tauri-project-host",
      "windows-native-e2e",
    ]);
    expect(SPIKE_SCOPE.excluded).toContain("billing");
    expect(SPIKE_SCOPE.excluded).toContain("real-models");
    expect(SPIKE_SCOPE.excluded).toContain("builder-agent");
  });
});
```

Create `vitest.config.ts` with `jsdom`, `globals: true`, `setupFiles: ["./src/test/setup.ts"]`, and test globs under `tests/unit` and `tests/component`. Create `src/test/setup.ts` importing `@testing-library/jest-dom/vitest`.

Run:

```powershell
pnpm --dir try/windows-core-spike test:unit -- tests/unit/spikeScope.test.ts
```

Expected: FAIL because `src/core/spikeScope.ts` does not exist.

- [ ] **Step 5: 实现最小范围常量并让测试通过**

Create `src/core/spikeScope.ts`:

```ts
export const SPIKE_SCOPE = Object.freeze({
  included: [
    "blockly-editor",
    "stable-ir",
    "interaction-manifest",
    "tool-contract",
    "deterministic-runtime",
    "tauri-project-host",
    "windows-native-e2e",
  ],
  excluded: [
    "accounts",
    "billing",
    "entitlements",
    "community",
    "cli",
    "official-skills",
    "real-models",
    "builder-agent",
    "custom-blocks",
    "native-agent-adapters",
    "macos",
    "mobile",
  ],
} as const);
```

Run:

```powershell
pnpm --dir try/windows-core-spike test:unit -- tests/unit/spikeScope.test.ts
pnpm --dir try/windows-core-spike build
cargo test --manifest-path try/windows-core-spike/src-tauri/Cargo.toml
```

Expected: 三条命令均通过；前端构建不访问网络。

- [ ] **Step 6: 锁定 Rust 依赖和最小权限**

Use these exact dependency versions in `src-tauri/Cargo.toml`:

```toml
[package]
name = "blocky-windows-core-spike"
version = "0.0.0"
description = "Disposable Windows Core architecture spike for Blocky"
edition = "2024"

[lib]
name = "blocky_windows_core_spike_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[features]
default = []
wdio = ["dep:tauri-plugin-wdio", "dep:tauri-plugin-wdio-webdriver"]

[build-dependencies]
tauri-build = { version = "2.6.3", features = [] }

[dependencies]
atomic-write-file = "0.3.0"
regex = "1.13.1"
serde = { version = "1.0.229", features = ["derive"] }
serde_json = "1.0.151"
sha2 = "0.11.0"
tauri = { version = "2.11.5", features = [] }
tauri-plugin-wdio = { version = "1.3.0", optional = true }
tauri-plugin-wdio-webdriver = { version = "1.3.0", optional = true }

[dev-dependencies]
tempfile = "3.27.0"
```

`capabilities/main.json` must contain only `core:default`; base `tauri.conf.json` must set a local CSP and `withGlobalTauri: false`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main",
  "description": "Normal Blocky Windows Core spike capability",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

Run:

```powershell
cargo fmt --manifest-path try/windows-core-spike/src-tauri/Cargo.toml --check
cargo check --manifest-path try/windows-core-spike/src-tauri/Cargo.toml --locked
```

Expected: 通过；普通 feature 集不编译 WDIO 插件。

- [ ] **Step 7: 提交任务**

```powershell
git add .gitignore try/windows-core-spike
git commit -m "spike: scaffold isolated Windows Core app"
```

### Task 2: 建立尖峰积木目录、六类连接语法和精确 100 积木夹具

**Files:**

- Create: `try/windows-core-spike/src/blockly/catalog.ts`
- Create: `try/windows-core-spike/src/blockly/connectionGrammar.ts`
- Create: `try/windows-core-spike/src/blockly/definitions.ts`
- Create: `try/windows-core-spike/src/blockly/fixtures.ts`
- Create: `try/windows-core-spike/src/blockly/workspaceAdapter.ts`
- Create: `try/windows-core-spike/tests/unit/catalog.test.ts`
- Create: `try/windows-core-spike/tests/unit/fixture.test.ts`
- Create: `try/windows-core-spike/tests/unit/connections.test.ts`

**Interfaces:**

- Consumes: Task 1 的本地 Blockly 13.2.1 依赖和 `JsonValue` 全局契约。
- Produces: `SPIKE_BLOCK_IDS`、`SpikeBlockId`、`registerSpikeBlocks()`、`createHundredBlockWorkspaceState()`、`saveWorkspace()`、`loadWorkspace()` 与六类连接元数据。

- [ ] **Step 1: 写目录和连接语法失败测试**

Create tests asserting all of the following:

```ts
expect(SPIKE_BLOCK_IDS).toHaveLength(31);
expect(new Set(SPIKE_BLOCK_IDS).size).toBe(31);
expect(CONNECTION_GRAMMARS).toEqual([
  "event-hat",
  "command",
  "typed-value",
  "boolean-condition",
  "statement-container",
  "reference",
]);
expect(getDefinition("core.interaction.chat_entry").hasInlineComposer).toBe(false);
expect(getDefinition("core.tool.reference").outputCheck).toBe("type.tool_ref");
expect(getDefinition("core.data.compare").outputCheck).toBe("type.boolean");
```

Run:

```powershell
pnpm --dir try/windows-core-spike test:unit -- tests/unit/catalog.test.ts tests/unit/connections.test.ts
```

Expected: FAIL because the catalog and definitions do not exist.

- [ ] **Step 2: 定义 31 个尖峰目录 ID**

`SPIKE_BLOCK_IDS` must contain exactly these IDs and no alias IDs:

```ts
export const SPIKE_BLOCK_IDS = [
  "core.agent.define",
  "core.agent.add_tool",
  "core.interaction.chat_entry",
  "core.interaction.accept_text",
  "core.interaction.accept_image",
  "core.interaction.accept_file",
  "core.interaction.accept_voice",
  "core.interaction.expose_skill",
  "core.interaction.expose_plugin",
  "core.interaction.current_entry",
  "core.interaction.reference",
  "core.event.manual_run",
  "core.message.incoming",
  "core.message.field",
  "core.message.create",
  "core.message.add_part",
  "core.message.reply",
  "core.message.send",
  "core.message.stream",
  "core.message.wait",
  "core.tool.define",
  "core.tool.parameter",
  "core.tool.result_schema",
  "core.tool.reference",
  "core.tool.call",
  "core.tool.result",
  "core.tool.require_approval",
  "core.data.literal",
  "core.data.record",
  "core.data.compare",
  "core.flow.if",
] as const;

export type SpikeBlockId = (typeof SPIKE_BLOCK_IDS)[number];
```

This subset proves the Core architecture; it is not a replacement for the confirmed 311-ID product catalog.

- [ ] **Step 3: 实现六类连接规则和专属视觉元数据**

Use only these Blockly connection checks:

| Grammar | Blockly rule | Spike examples |
|---|---|---|
| `event-hat` | no previous; next=`slot.command` | `core.event.manual_run` |
| `command` | previous/next=`slot.command` | `core.message.reply` |
| `typed-value` | output exact `type.*` | `core.data.literal`, `core.tool.call` |
| `boolean-condition` | output=`type.boolean`, hexagonal output | `core.data.compare` |
| `statement-container` | named statement inputs with exact slot checks | Agent, entry, Tool, `core.flow.if` |
| `reference` | output exact reference type | entry and Tool references |

Define dedicated visual roles for Agent, interaction, Tool, message, event, data and flow, but do not add a seventh connection grammar. `core.interaction.chat_entry` must have two distinct statement inputs: `CAPABILITIES` checked as `slot.entry_capability`, and `HANDLER` checked as `slot.command`.

Start `connectionGrammar.ts` with the exact shared constants; every Blockly JSON definition imports them instead of spelling checks independently:

```ts
export const CONNECTION_GRAMMARS = [
  "event-hat",
  "command",
  "typed-value",
  "boolean-condition",
  "statement-container",
  "reference",
] as const;

export const CONNECTION_CHECK = Object.freeze({
  command: "slot.command",
  agentMember: "slot.agent_member",
  entryCapability: "slot.entry_capability",
  toolContract: "slot.tool_contract",
  boolean: "type.boolean",
  agentRef: "type.agent_ref",
  entryRef: "type.interaction_entry_ref",
  toolRef: "type.tool_ref",
  message: "type.message",
  json: "type.json",
} as const);

export const commandConnections = Object.freeze({
  previousStatement: CONNECTION_CHECK.command,
  nextStatement: CONNECTION_CHECK.command,
});
```

- [ ] **Step 4: 写精确 100 积木夹具失败测试**

Create `fixture.test.ts`:

```ts
import * as Blockly from "blockly/core";
import { afterEach, describe, expect, it } from "vitest";
import { registerSpikeBlocks } from "../../src/blockly/definitions";
import {
  countSerializedBlocks,
  createHundredBlockWorkspaceState,
} from "../../src/blockly/fixtures";

describe("100-block fixture", () => {
  const workspaces: Blockly.Workspace[] = [];

  afterEach(() => {
    for (const workspace of workspaces) workspace.dispose();
  });

  it("loads exactly 100 locally registered blocks", () => {
    registerSpikeBlocks();
    const state = createHundredBlockWorkspaceState();
    expect(countSerializedBlocks(state)).toBe(100);

    const workspace = new Blockly.Workspace();
    workspaces.push(workspace);
    Blockly.serialization.workspaces.load(state, workspace);
    expect(workspace.getAllBlocks(false)).toHaveLength(100);
  });
});
```

Run:

```powershell
pnpm --dir try/windows-core-spike test:unit -- tests/unit/fixture.test.ts
```

Expected: FAIL because the fixture builder is missing.

- [ ] **Step 5: 生成稳定、有效、精确 100 块的夹具**

Implement the fixture with stable IDs `block-001` through `block-100`. It must include:

- one `core.agent.define` containing two chat entries;
- all six entry capability blocks at least once;
- one `core.tool.define` with parameter, result Schema and approval declaration;
- one `core.agent.add_tool` with `core.tool.reference`;
- one explicit `core.tool.call` using the same `toolId`;
- event, command, typed value, boolean condition, C-shaped container and reference connections;
- enough valid deterministic event/reply/literal chains to reach exactly 100 blocks.

Use a recursive counter that counts `block`, every named `inputs[*].block`, and every `next.block`. Throw during fixture creation unless the count is exactly 100; never pad with unknown block types.

Run:

```powershell
pnpm --dir try/windows-core-spike test:unit -- tests/unit/catalog.test.ts tests/unit/connections.test.ts tests/unit/fixture.test.ts
```

Expected: PASS; no duplicate block IDs and exact count 100.

- [ ] **Step 6: 验证 Blockly 官方 JSON 序列化往返**

In `workspaceAdapter.ts`, expose only these functions:

```ts
export function saveWorkspace(workspace: Blockly.Workspace): JsonValue;
export function loadWorkspace(
  state: JsonValue,
  workspace: Blockly.Workspace,
): void;
export function listWorkspaceBlockIds(workspace: Blockly.Workspace): string[];
```

Add a test that loads the fixture, changes one block to collapsed, saves, loads into a new workspace, and asserts:

```ts
expect(listWorkspaceBlockIds(reloaded)).toEqual(listWorkspaceBlockIds(original));
expect(reloaded.getAllBlocks(false)).toHaveLength(100);
expect(reloaded.getBlockById("block-001")?.isCollapsed()).toBe(true);
```

Run the full unit group and commit:

```powershell
pnpm --dir try/windows-core-spike test:unit
git add try/windows-core-spike
git commit -m "spike: define core block grammar and 100-block fixture"
```

### Task 3: 将 Blockly JSON 编译为确定性稳定 IR

**Files:**

- Create: `try/windows-core-spike/src/core/json.ts`
- Create: `try/windows-core-spike/src/core/ir.ts`
- Create: `try/windows-core-spike/src/core/compileWorkspace.ts`
- Create: `try/windows-core-spike/src/core/diagnostics.ts`
- Create: `try/windows-core-spike/tests/unit/compiler.test.ts`

**Interfaces:**

- Consumes: Task 2 的 31-ID 目录、序列化工作区 JSON 与连接元数据。
- Produces: `canonicalizeJson()`、`stableStringify()`、`compileWorkspace()`、`CompileResult`、`Diagnostic` 和 block ID → IR node ID 来源映射。

- [ ] **Step 1: 写确定性编译失败测试**

Create tests for these exact invariants:

```ts
const first = compileWorkspace(createHundredBlockWorkspaceState());
const second = compileWorkspace(createHundredBlockWorkspaceState());

expect(first.diagnostics).toEqual([]);
expect(stableStringify(first.program)).toBe(stableStringify(second.program));
expect(first.sourceMap["block-001"]).toEqual({ nodeId: "block-001" });
expect(first.program.schemaVersion).toBe("blocky.ir/v0-spike");
```

Clone the fixture, alter only `x`, `y`, `collapsed`, and top-level JSON object key order, then assert the compiled program is byte-identical. Reverse two commands in a `next` chain and assert the output differs.

Also test these blocking diagnostics:

- duplicate stable block ID → `IR_DUPLICATE_BLOCK_ID`;
- block type outside the 31-ID spike catalog → `IR_UNKNOWN_BLOCK_TYPE`;
- invalid input connection declared by the serialized shape → `IR_INVALID_CONNECTION`.

Run:

```powershell
pnpm --dir try/windows-core-spike test:unit -- tests/unit/compiler.test.ts
```

Expected: FAIL because compiler modules do not exist.

- [ ] **Step 2: 实现 JSON 类型、规范化和稳定序列化**

`json.ts` must recursively sort object keys, retain array order, reject `undefined`, functions, symbols, `NaN`, and infinities, and serialize without whitespace:

```ts
export function canonicalizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON number must be finite");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalizeJson(item)]),
    );
  }
  throw new TypeError(`Unsupported JSON value: ${typeof value}`);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}
```

- [ ] **Step 3: 实现单向、纯函数编译器**

`compileWorkspace` must:

1. accept serialized JSON, never a live Blockly object;
2. discard visual-only `x`, `y`, `collapsed`, `comment`, and UI state from IR;
3. preserve semantic field values, named inputs, and `next` order;
4. sort semantic top-level roots by stable block ID;
5. use the Blockly block ID unchanged as IR node ID;
6. build `sourceMap: Record<string, { nodeId: string }>` for runtime highlighting;
7. return diagnostics rather than throwing for user-authored structural errors;
8. throw only for programmer errors or values that are not JSON.

Use this result type:

```ts
export interface CompileResult {
  program: BlockyProgram;
  sourceMap: Record<string, { nodeId: string }>;
  diagnostics: Diagnostic[];
}
```

Every `Diagnostic` must include stable `code`, Chinese `message`, severity, and optional `blockId`.

- [ ] **Step 4: 让编译测试通过并检查没有 Blockly 运行时泄漏到 core**

Run:

```powershell
pnpm --dir try/windows-core-spike test:unit -- tests/unit/compiler.test.ts
rg -n 'from .*blockly|Blockly\.' try/windows-core-spike/src/core
```

Expected: tests PASS; `rg` returns no matches under `src/core`, proving the semantic compiler remains pure TypeScript.

- [ ] **Step 5: 提交任务**

```powershell
pnpm --dir try/windows-core-spike test:unit
pnpm --dir try/windows-core-spike build
git add try/windows-core-spike
git commit -m "spike: compile Blockly state into stable IR"
```

### Task 4: 从 IR 编译唯一的 `InteractionManifest`

**Files:**

- Create: `try/windows-core-spike/src/core/interactionManifest.ts`
- Create: `try/windows-core-spike/tests/unit/interactionManifest.test.ts`

**Interfaces:**

- Consumes: Task 3 的 `BlockyProgram`、`IrNode` 与 `Diagnostic`。
- Produces: `compileInteractionManifest(program): InteractionCompileResult`；React 和 E2E 只能读取该结果来决定右侧入口能力。

- [ ] **Step 1: 写零、单、多入口失败测试**

Create tests covering all of these cases:

```ts
expect(compileInteractionManifest(programWithoutEntries).manifest).toEqual({
  schemaVersion: "blocky.interaction/v0-spike",
  entries: [],
});

expect(twoEntryResult.manifest.entries.map((entry) => entry.displayName)).toEqual([
  "输入 1",
  "客户支持",
]);
expect(twoEntryResult.manifest.entries.map((entry) => entry.id)).toEqual([
  "entry-stable-a",
  "entry-stable-b",
]);
```

The test data must then rename and reorder both entries while retaining their IDs, and assert routing still uses the same stable IDs. Add tests for duplicate display names as a warning and duplicate IDs as a blocking error inherited from the IR compiler.

Run:

```powershell
pnpm --dir try/windows-core-spike test:unit -- tests/unit/interactionManifest.test.ts
```

Expected: FAIL because `interactionManifest.ts` does not exist.

- [ ] **Step 2: 编译入口所有权、默认名称和能力**

Implement:

```ts
export interface InteractionCompileResult {
  manifest: InteractionManifest;
  diagnostics: Diagnostic[];
}

export function compileInteractionManifest(
  program: BlockyProgram,
): InteractionCompileResult;
```

Rules:

1. A chat entry is valid only when nested under one `core.agent.define` and when its `HANDLER` input is non-null.
2. `ownerAgentId` always comes from the enclosing Agent node ID, never from display text.
3. Blank names become `输入 1`, `输入 2` in that Agent's semantic entry order; user-provided names are preserved.
4. `acceptedParts` uses fixed order `text`, `image`, `file`, `voice`, independent of Blockly JSON object key order.
5. `exposedSkills` and `exposedPluginActions` are deduplicated, sorted stable IDs from explicit capability blocks only.
6. An Agent having a Tool, Skill, or plugin elsewhere does not change the manifest.
7. An orphan entry emits `INTERACTION_ORPHAN_ENTRY`; an empty handler emits `INTERACTION_EMPTY_HANDLER`; both are excluded from `entries`.
8. Duplicate display names emit `INTERACTION_DUPLICATE_DISPLAY_NAME` warning but do not alter stable IDs.

- [ ] **Step 3: 证明能力只来自入口能力区**

Add one test that gives the Agent an internal Skill/Tool reference but no entry exposure block:

```ts
expect(entry.acceptedParts).toEqual(["text"]);
expect(entry.exposedSkills).toEqual([]);
expect(entry.exposedPluginActions).toEqual([]);
```

Then insert `core.interaction.expose_skill` and `core.interaction.expose_plugin` into `CAPABILITIES` and assert only those stable IDs appear.

Run:

```powershell
pnpm --dir try/windows-core-spike test:unit -- tests/unit/interactionManifest.test.ts
```

Expected: PASS for zero, single, multiple, renamed, reordered, invalid and capability-isolation cases.

- [ ] **Step 4: 提交任务**

```powershell
pnpm --dir try/windows-core-spike test:unit
git add try/windows-core-spike
git commit -m "spike: compile interaction manifests from entry blocks"
```

### Task 5: 建立一等 Tool 契约、引用和显式调用解析

**Files:**

- Create: `try/windows-core-spike/src/core/toolContract.ts`
- Create: `try/windows-core-spike/tests/unit/toolContract.test.ts`

**Interfaces:**

- Consumes: Task 3 的 `BlockyProgram`/`Diagnostic` 和全局 `ToolContract`/`ToolCall` 契约。
- Produces: `compileToolRegistry()`、`validateToolArgs()`、`resolveToolUsages()`，以及按稳定 Tool ID 共享对象身份的只读注册表。

- [ ] **Step 1: 写共享契约失败测试**

Create a fixture with one `core.tool.define`, one `core.agent.add_tool` containing `core.tool.reference`, and one `core.tool.call` containing another reference. Assert:

```ts
const registry = compileToolRegistry(program);
const usages = resolveToolUsages(program, registry.contracts);

expect(registry.diagnostics).toEqual([]);
expect(registry.contracts.get("tool-weather")?.name).toBe("查询天气");
expect(usages.agentAttachments[0].contract).toBe(
  usages.explicitCalls[0].contract,
);
expect(usages.explicitCalls[0].call.toolId).toBe("tool-weather");
```

The strict object identity assertion is intentional: all usages resolve through one registry entry instead of copying Schema data.

Add failures for duplicate Tool ID, missing referenced Tool, duplicate parameter, invalid default value, unexpected argument, missing required argument, and a Tool result Schema that is not an object.

Run:

```powershell
pnpm --dir try/windows-core-spike test:unit -- tests/unit/toolContract.test.ts
```

Expected: FAIL because the Tool compiler is missing.

- [ ] **Step 2: 编译 Tool 容器为单一注册表**

Implement these public functions:

```ts
export interface ToolRegistryResult {
  contracts: Map<string, Readonly<ToolContract>>;
  diagnostics: Diagnostic[];
}

export function compileToolRegistry(program: BlockyProgram): ToolRegistryResult;

export function validateToolArgs(
  contract: ToolContract,
  args: Record<string, JsonValue>,
): Diagnostic[];

export function resolveToolUsages(
  program: BlockyProgram,
  contracts: Map<string, Readonly<ToolContract>>,
): {
  agentAttachments: Array<{
    agentId: string;
    referenceBlockId: string;
    contract: Readonly<ToolContract>;
  }>;
  explicitCalls: Array<{
    call: ToolCall;
    contract: Readonly<ToolContract>;
  }>;
  diagnostics: Diagnostic[];
};
```

Tool compilation rules:

- Stable Tool identity comes from the Tool container's `TOOL_ID` field; display name changes never change references.
- `core.tool.parameter` chains compile to one object `inputSchema`; only string, number and boolean are admitted in this spike.
- `core.tool.result_schema` compiles to one object `outputSchema`.
- `core.tool.require_approval` sets `requiresApproval: true`; callers cannot override it.
- `core.tool.reference` contains only `toolId`, never a copied Schema.
- `core.tool.call` compiles only `callBlockId`, `toolId`, and canonical JSON arguments.
- Missing or invalid contracts produce diagnostics before runtime; they do not fall back to an arbitrary Tool with the same display name.

- [ ] **Step 3: 验证修改契约会同时影响两种用法**

In a test, compile once with required parameter `city`, then change the Tool definition to required `cityName` without changing the two references. Recompile and assert:

```ts
expect(updatedUsages.agentAttachments[0].contract.inputSchema.required).toEqual([
  "cityName",
]);
expect(updatedUsages.explicitCalls[0].contract.inputSchema.required).toEqual([
  "cityName",
]);
expect(updatedUsages.diagnostics.map((item) => item.code)).toContain(
  "TOOL_CALL_MISSING_REQUIRED_ARGUMENT",
);
```

Run:

```powershell
pnpm --dir try/windows-core-spike test:unit -- tests/unit/toolContract.test.ts
```

Expected: PASS; both use sites see one updated contract and the unsafe call is reported without deleting its arguments.

- [ ] **Step 4: 提交任务**

```powershell
pnpm --dir try/windows-core-spike test:unit
git add try/windows-core-spike
git commit -m "spike: unify tool references and explicit calls"
```

### Task 6: 实现确定性模拟运行时和可回映事件

**Files:**

- Create: `try/windows-core-spike/src/core/runtimeEvents.ts`
- Create: `try/windows-core-spike/src/core/deterministicRuntime.ts`
- Create: `try/windows-core-spike/src/core/securityScan.ts`
- Create: `try/windows-core-spike/tests/unit/runtime.test.ts`
- Create: `try/windows-core-spike/tests/unit/securityScan.test.ts`

**Interfaces:**

- Consumes: Task 3 的 Program/source map、Task 5 的 Tool 注册表和全局 `RuntimeEvent` 契约。
- Produces: `runProgram()`、`RuntimeDependencies`、`scanSensitiveValues()`、`redactSensitiveValues()` 和唯一运行事件出口。

- [ ] **Step 1: 写正常流式运行失败测试**

Use a fixed `runIdFactory` returning `run-test-001`, run input `你好`, and assert the exact event types:

```ts
expect(events.map((event) => event.type)).toEqual([
  "run.started",
  "block.started",
  "model.chunk",
  "model.chunk",
  "block.completed",
  "run.completed",
]);
expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
expect(events.filter((event) => event.blockId).every((event) =>
  sourceMap[event.blockId as string] !== undefined,
)).toBe(true);
expect(events[2].data).toEqual({ text: "已收到：" });
expect(events[3].data).toEqual({ text: "你好" });
```

Run:

```powershell
pnpm --dir try/windows-core-spike test:unit -- tests/unit/runtime.test.ts
```

Expected: FAIL because no runtime exists.

- [ ] **Step 2: 实现注入依赖的模拟运行时**

Use this dependency boundary:

```ts
export interface RuntimeDependencies {
  runIdFactory(): string;
  model: {
    stream(input: string, signal: AbortSignal): AsyncIterable<string>;
  };
  tools: Map<string, Readonly<ToolContract>>;
  requestApproval(request: {
    runId: string;
    toolId: string;
    callBlockId: string;
    permissions: string[];
  }): Promise<"approved" | "denied">;
}

export async function runProgram(options: {
  program: BlockyProgram;
  sourceMap: Record<string, { nodeId: string }>;
  input: string;
  signal: AbortSignal;
  dependencies: RuntimeDependencies;
  onEvent(event: RuntimeEvent): void;
}): Promise<void>;
```

The deterministic model must have no network dependency. Normal input yields `已收到：` then the exact input. Input `/error` throws stable code `MODEL_SIMULATED_FAILURE`. Input `/permission` executes the first explicit Tool call with `requiresApproval`, emits a permission event, waits for the injected decision, and only then emits Tool start/completion or a stable denial failure.

Every event with a `blockId` must refer to an existing source-map key. Sequence starts at 1 and increases by one. The runtime must check `AbortSignal` before every block, model chunk, approval continuation and Tool completion.

- [ ] **Step 3: 写取消、错误和权限失败测试**

Add these assertions:

```ts
expect(cancelEvents.at(-1)?.type).toBe("run.cancelled");
expect(cancelEvents.some((event) => event.type === "run.completed")).toBe(false);

expect(errorEvents.at(-1)).toMatchObject({
  type: "run.failed",
  data: { code: "MODEL_SIMULATED_FAILURE" },
});

expect(permissionEvents.map((event) => event.type)).toContain(
  "tool.permission_requested",
);
expect(permissionEvents.indexOf(permissionRequested)).toBeLessThan(
  permissionEvents.indexOf(toolStarted),
);
```

Test both `approved` and `denied`; denied must never emit `tool.started`.

- [ ] **Step 4: 先写敏感值检测和脱敏失败测试**

Construct test values at runtime so the repository never contains a complete token:

```ts
const fakeToken = ["sk", "-", "test", "A".repeat(24)].join("");
const fakePath = ["C", ":\\", "Users\\Example\\secret.txt"].join("");

expect(scanSensitiveValues({ fakeToken, fakePath })).toEqual([
  expect.objectContaining({ kind: "model-token" }),
  expect.objectContaining({ kind: "windows-absolute-path" }),
]);
expect(redactSensitiveValues({ fakeToken })).toEqual({
  fakeToken: "[REDACTED:model-token]",
});
```

The scanner must cover model-token prefixes, GitHub token prefixes, AWS access key form, `Bearer` authorization, PEM private-key headers, cookies, and Windows/Unix absolute paths. Do not scan keys such as `projectId`; recursively scan string values and report their JSON path.

- [ ] **Step 5: 在事件出口统一脱敏**

All runtime events must pass through one `createRuntimeEvent` function. It canonicalizes data and calls `redactSensitiveValues` before the event reaches UI or logs. Add a test sending the runtime-created fake token and assert neither `stableStringify(events)` nor captured log text contains the original value.

Run:

```powershell
pnpm --dir try/windows-core-spike test:unit -- tests/unit/runtime.test.ts tests/unit/securityScan.test.ts
```

Expected: PASS for normal stream, cancellation, simulated failure, approval/denial, block mapping, sequence and redaction.

- [ ] **Step 6: 提交任务**

```powershell
pnpm --dir try/windows-core-spike test:unit
pnpm --dir try/windows-core-spike build
git add try/windows-core-spike
git commit -m "spike: add deterministic cancellable runtime"
```

### Task 7: 组装左库、中画布、右双标签和 Manifest 驱动输入栏

**Files:**

- Replace: `try/windows-core-spike/src/App.tsx` if generated
- Replace: `try/windows-core-spike/src/App.css` if generated
- Create: `try/windows-core-spike/src/app/App.tsx`
- Create: `try/windows-core-spike/src/app/app.css`
- Create: `try/windows-core-spike/src/app/useSpikeController.ts`
- Create: `try/windows-core-spike/src/blockly/BlocklyCanvas.tsx`
- Create: `try/windows-core-spike/src/blockly/toolbox.ts`
- Create: `try/windows-core-spike/src/builder/BuilderPlaceholder.tsx`
- Create: `try/windows-core-spike/src/runtime/RuntimePanel.tsx`
- Create: `try/windows-core-spike/src/runtime/RuntimeComposer.tsx`
- Create: `try/windows-core-spike/src/runtime/EventTimeline.tsx`
- Create: `try/windows-core-spike/src/project/SpikeProjectSnapshot.ts`
- Create: `try/windows-core-spike/src/host/HostBridge.ts`
- Create: `try/windows-core-spike/src/host/InMemoryHostBridge.ts`
- Create: `try/windows-core-spike/tests/component/App.test.tsx`
- Create: `try/windows-core-spike/tests/component/RuntimeComposer.test.tsx`

**Interfaces:**

- Consumes: Tasks 2–6 的 Blockly adapter、编译器、manifest、Tool 注册表和确定性运行时。
- Produces: `BlocklyCanvasHandle`、`RuntimeComposerProps`、`RuntimeInput`、`HostBridge`、`createSpikeProjectSnapshot()` 和可由 Host 注入的三栏 React 应用。

- [ ] **Step 1: 写双标签和无入口失败测试**

Create `App.test.tsx` with an injected `InMemoryHostBridge` and an empty workspace. Assert:

```ts
expect(screen.getByRole("tab", { name: "搭建助手" })).toBeEnabled();
expect(screen.getByRole("tab", { name: "运行 Agent" })).toBeDisabled();
expect(screen.getByText("添加聊天入口后才能运行作品")).toBeInTheDocument();
expect(screen.queryByRole("textbox", { name: "发送给 Agent" })).not.toBeInTheDocument();
```

Then load a valid entry and assert the run tab becomes enabled without remounting the app.

Run:

```powershell
pnpm --dir try/windows-core-spike test:component -- tests/component/App.test.tsx
```

Expected: FAIL because the app components do not exist.

- [ ] **Step 2: 建立右侧输入栏的纯 Manifest 接口**

`RuntimeComposer` must accept no workspace or IR prop:

```ts
export interface RuntimeComposerProps {
  manifest: InteractionManifest;
  activeEntryId: string | null;
  onActiveEntryIdChange(entryId: string): void;
  onSubmit(message: RuntimeInput): Promise<void>;
  disabled: boolean;
}

export interface RuntimeInput {
  entryId: string;
  text?: string;
  attachments: DraftAttachment[];
  exposedSkillId?: string;
  exposedPluginActionId?: string;
}

export interface DraftAttachment {
  id: string;
  kind: "image" | "file" | "voice";
  name: string;
  bytes: number;
}
```

Controls must use these stable test IDs:

- `runtime-text-input`
- `runtime-send`
- `runtime-add-image`
- `runtime-add-file`
- `runtime-add-voice`
- `runtime-skill-menu`
- `runtime-plugin-menu`
- `runtime-entry-select`

Do not render a disabled attachment button when the capability is absent; omit the add control entirely so the visible UI exactly reflects the entry. Existing unsupported draft attachments remain as chips with an explicit warning.

- [ ] **Step 3: 写六种能力和多入口草稿失败测试**

In `RuntimeComposer.test.tsx`, start with two entries:

- `entry-a`: default `输入 1`, text + image;
- `entry-b`: renamed `文件处理`, text + file + voice + one Skill + one plugin action.

Assert the exact controls per entry. Type `A 草稿`, switch to entry B, type `B 草稿`, switch back, and assert both drafts persist separately. Add an image draft to A, remove image from A's next manifest, and assert:

```ts
expect(screen.queryByTestId("runtime-add-image")).not.toBeInTheDocument();
expect(screen.getByText("photo.png")).toBeInTheDocument();
expect(screen.getByText("当前入口已不接受该附件，请删除或切回支持它的入口")).toBeInTheDocument();
```

Run:

```powershell
pnpm --dir try/windows-core-spike test:component -- tests/component/RuntimeComposer.test.tsx
```

Expected: FAIL before implementation, then PASS after the component stores drafts by stable entry ID rather than display name or array index.

- [ ] **Step 4: 实现 Blockly 画布组件和本地工具箱**

`BlocklyCanvas` owns one `Blockly.WorkspaceSvg`, registers local block definitions, injects the local toolbox, and exposes a narrow ref:

```ts
export interface BlocklyCanvasHandle {
  load(state: JsonValue): void;
  save(): JsonValue;
  blockCount(): number;
  highlight(blockId: string | null): void;
  zoomIn(): void;
  zoomOut(): void;
}
```

On each non-UI Blockly change, save JSON, compile IR, compile the manifest and Tool registry, and send one immutable `EditorProjection` to the controller. Debounce projection by 75 ms, but flush immediately before save or run. Dispose the workspace and listener on unmount.

Use a local toolbox with categories `AI 伙伴`, `交互入口`, `消息`, `工具`, `数据`, `流程`. Do not import Blockly from a URL or add a `<script src>` tag.

- [ ] **Step 5: 组装 Scratch 式三栏和两个隔离标签**

The app layout must be:

```text
┌──────────────┬──────────────────────────────┬──────────────────────┐
│ 本地积木库   │ Blockly 画布                 │ 搭建助手 | 运行 Agent│
│              │                              │                      │
│ 31 个尖峰块  │ 载入100块 / 保存 / 重开      │ Manifest 驱动输入栏  │
└──────────────┴──────────────────────────────┴──────────────────────┘
```

CSS uses `grid-template-columns: 260px minmax(520px, 1fr) 380px`, a minimum window size of 1180 × 720, visible focus rings and readable contrast. `BuilderPlaceholder` displays:

```text
Windows Core 尖峰暂不连接搭建模型。
手工编辑、保存、编译和确定性运行不受影响。
```

It must not share messages, drafts, attachments, permission state or runtime events with `RuntimePanel`.

- [ ] **Step 6: 连接运行事件与画布高亮**

`useSpikeController` owns `AbortController`, runtime status, event list and `activeBlockId`. For each `block.started`, call `canvas.highlight(blockId)`; for terminal run events, clear the highlight after recording the event. `EventTimeline` renders sequence, type, block ID and redacted summary.

The controller must reject run when compilation has any error diagnostic or when selected entry ID is absent from the current manifest.

Use one event reducer so UI state cannot diverge from the event stream:

```ts
const TERMINAL_EVENTS = new Set<RuntimeEventType>([
  "run.completed",
  "run.cancelled",
  "run.failed",
]);

function reduceRuntimeEvent(
  state: RuntimeViewState,
  event: RuntimeEvent,
): RuntimeViewState {
  const events = [...state.events, event].slice(-200);
  if (event.type === "block.started" && event.blockId) {
    return { ...state, events, activeBlockId: event.blockId, status: "running" };
  }
  if (TERMINAL_EVENTS.has(event.type)) {
    return { ...state, events, activeBlockId: null, status: event.type };
  }
  return { ...state, events };
}
```

- [ ] **Step 7: 创建确定性尖峰快照，不宣称正式 `.blocky`**

Implement:

```ts
export function createSpikeProjectSnapshot(input: {
  projectId: string;
  workspace: JsonValue;
  program: BlockyProgram;
  interactionManifest: InteractionManifest;
}): SpikeProjectSnapshot {
  return {
    schemaVersion: "blocky.spike-project/v1",
    projectId: input.projectId,
    workspace: canonicalizeJson(input.workspace),
    program: input.program,
    interactionManifest: input.interactionManifest,
  };
}
```

Do not add timestamps, host paths or secrets to the snapshot. `HostBridge` contains only `saveProject(request)` and `loadProject(projectId)`; component tests use `InMemoryHostBridge`.

- [ ] **Step 8: 运行组件与构建测试并提交**

```powershell
pnpm --dir try/windows-core-spike test:component
pnpm --dir try/windows-core-spike test:unit
pnpm --dir try/windows-core-spike build
git add try/windows-core-spike
git commit -m "spike: project manifests into the desktop runtime panel"
```

Expected: all PASS; no input/send UI exists inside `core.interaction.chat_entry` Blockly definition.

### Task 8: 实现受限、原子且可测试的 Tauri 项目 Host

**Files:**

- Create: `try/windows-core-spike/src/host/TauriHostBridge.ts`
- Modify: `try/windows-core-spike/src/app/App.tsx`
- Modify: `try/windows-core-spike/src/main.tsx`
- Modify: `try/windows-core-spike/src-tauri/src/lib.rs`
- Create: `try/windows-core-spike/src-tauri/src/project_store.rs`
- Create: `try/windows-core-spike/src-tauri/tests/project_store.rs`
- Modify: `try/windows-core-spike/src-tauri/tauri.conf.json`
- Verify: `try/windows-core-spike/src-tauri/capabilities/main.json`

**Interfaces:**

- Consumes: Task 7 的 `HostBridge`、`SaveProjectRequest`、`ProjectRecord` 与确定性 `SpikeProjectSnapshot`。
- Produces: Rust `ProjectStore::save/load`、Tauri `save_project/load_project` commands 和 TypeScript `TauriHostBridge`。

- [ ] **Step 1: 写 Rust Host 失败测试**

Use `tempfile::tempdir()` and test the pure `ProjectStore` without launching Tauri. Required cases:

```rust
assert_eq!(saved.project_id, "demo-project");
assert_eq!(loaded.json, json);
assert_eq!(loaded.sha256, saved.sha256);
assert_eq!(loaded.bytes, json.as_bytes().len() as u64);
```

Reject with exact codes:

- `PROJECT_ID_INVALID` for empty, uppercase, slash, backslash, `..`, or more than 64 characters;
- `PROJECT_TOO_LARGE` for more than 5 MiB;
- `PROJECT_JSON_INVALID` for malformed JSON;
- `PROJECT_SCHEMA_UNSUPPORTED` unless schema is `blocky.spike-project/v1`;
- `PROJECT_ID_MISMATCH` when request and JSON project IDs differ;
- `PROJECT_SENSITIVE_VALUE` for token, cookie, private-key header or absolute path string values;
- `PROJECT_NOT_FOUND` for absent IDs.

Run:

```powershell
cargo test --manifest-path try/windows-core-spike/src-tauri/Cargo.toml project_store -- --nocapture
```

Expected: FAIL because `project_store.rs` is missing.

- [ ] **Step 2: 实现路径不可注入的原子存储**

Use this structure:

```rust
pub const MAX_PROJECT_BYTES: usize = 5 * 1024 * 1024;

pub struct ProjectStore {
    root: PathBuf,
}

impl ProjectStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn save(&self, request: SaveProjectRequest) -> Result<ProjectRecord, HostError>;

    pub fn load(&self, project_id: &str) -> Result<ProjectRecord, HostError>;
}
```

Validation order is project ID → byte limit → JSON parse → schema/project ID → recursive sensitive-value scan. Resolve the target only as `root.join(format!("{}.json", project_id))`; never accept a path from TypeScript.

Write with `atomic_write_file::AtomicWriteFile`:

```rust
let mut file = AtomicWriteFile::open(&target)
    .map_err(|error| HostError::io("PROJECT_WRITE_OPEN_FAILED", error))?;
file.write_all(request.json.as_bytes())
    .map_err(|error| HostError::io("PROJECT_WRITE_FAILED", error))?;
file.commit()
    .map_err(|error| HostError::io("PROJECT_WRITE_COMMIT_FAILED", error))?;
```

Compute lowercase SHA-256 from the exact UTF-8 bytes using `sha2`; return no filesystem path in `ProjectRecord` or error messages.

- [ ] **Step 3: 注册两个窄 Tauri commands**

`lib.rs` must resolve its own app-data directory and register only:

```rust
#[tauri::command]
fn save_project(
    app: tauri::AppHandle,
    request: SaveProjectRequest,
) -> Result<ProjectRecord, HostError>;

#[tauri::command]
fn load_project(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<ProjectRecord, HostError>;
```

The root is `app.path().app_data_dir()/BlockySpike/projects`. Do not expose directory listing, delete, arbitrary read, shell or URL commands.

- [ ] **Step 4: 实现 TypeScript Host 桥并验证字节级往返**

`TauriHostBridge` must call:

```ts
return invoke<ProjectRecord>("save_project", { request });
return invoke<ProjectRecord>("load_project", { projectId });
```

Before invoking save, call `scanSensitiveValues(snapshot)` and refuse locally if any findings exist. After load, parse, validate the `blocky.spike-project/v1` schema with Zod, regenerate IR/manifest from workspace, and fail with `PROJECT_DERIVED_DATA_MISMATCH` if stored derived data differs. This detects corruption or stale compiled data.

Add a component test that saves, clears the workspace, reloads, and asserts stable JSON and 100 block IDs are restored.

- [ ] **Step 5: 锁定 CSP 和普通构建权限**

Base `tauri.conf.json` must include:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Blocky Windows Core Spike",
  "version": "0.0.0",
  "identifier": "ai.blocky.windowscorespike",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": false,
    "windows": [
      {
        "label": "main",
        "title": "Blocky Windows Core Spike",
        "width": 1440,
        "height": 900,
        "minWidth": 1180,
        "minHeight": 720
      }
    ],
    "security": {
      "capabilities": ["main"],
      "csp": "default-src 'self'; img-src 'self' asset: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src ipc: http://ipc.localhost"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"]
  }
}
```

No `http:` or `https:` origin may appear in CSP except the Tauri schema URL and build-only `devUrl`; release frontend assets must be relative and local.

- [ ] **Step 6: 运行 Host、前端集成和 release 构建**

```powershell
cargo fmt --manifest-path try/windows-core-spike/src-tauri/Cargo.toml --check
cargo clippy --manifest-path try/windows-core-spike/src-tauri/Cargo.toml --all-targets --no-default-features -- -D warnings
cargo test --manifest-path try/windows-core-spike/src-tauri/Cargo.toml --locked
pnpm --dir try/windows-core-spike test
pnpm --dir try/windows-core-spike tauri build --no-bundle
```

Expected: all PASS; a normal release executable is built without WDIO feature or permissions.

- [ ] **Step 7: 提交任务**

```powershell
git add try/windows-core-spike
git commit -m "spike: add constrained atomic project host"
```

### Task 9: 建立仅测试可用的 Windows 原生 WebdriverIO 通道

**Files:**

- Create: `try/windows-core-spike/wdio.conf.ts`
- Create: `try/windows-core-spike/src/test/wdioBootstrap.ts`
- Create: `try/windows-core-spike/src/test/wdioHooks.ts`
- Modify: `try/windows-core-spike/src/main.tsx`
- Modify: `try/windows-core-spike/src/app/App.tsx`
- Modify: `try/windows-core-spike/src-tauri/Cargo.toml`
- Modify: `try/windows-core-spike/src-tauri/src/lib.rs`
- Create: `try/windows-core-spike/src-tauri/tauri.wdio.conf.json`
- Create: `try/windows-core-spike/src-tauri/capabilities/wdio.json`
- Create: `try/windows-core-spike/tests/e2e/windows-core.e2e.ts`

**Interfaces:**

- Consumes: Task 8 的可编译 Tauri 应用、真实 Host commands 和 Task 7 的 DOM/test IDs。
- Produces: Cargo `wdio` feature、独立测试 capability/config、`window.__BLOCKY_SPIKE_TEST__` 测试钩子和原生 Windows Core E2E。

- [ ] **Step 1: 先写普通构建不含测试权限的失败检查**

Build the normal frontend and inspect it:

```powershell
pnpm --dir try/windows-core-spike build
rg -n "wdioTauri|wdio:default|withGlobalTauri" try/windows-core-spike/dist
cargo tree --manifest-path try/windows-core-spike/src-tauri/Cargo.toml --no-default-features | Select-String -Pattern "tauri-plugin-wdio"
```

Expected after final isolation: both searches produce no matches. At this step, preserve the command as a gate even if it already passes.

- [ ] **Step 2: 仅在 Cargo `wdio` feature 注册 Rust 测试插件**

Use a builder helper in `lib.rs`:

```rust
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(tauri::generate_handler![save_project, load_project])
        .run(tauri::generate_context!())
        .expect("failed to run Blocky Windows Core spike");
}
```

The normal `main.rs` only calls `blocky_windows_core_spike_lib::run()`.

- [ ] **Step 3: 仅在 Vite `wdio` mode 导入前端插件和测试钩子**

Create `wdioBootstrap.ts`:

```ts
export async function installWdioSupport(): Promise<void> {
  if (import.meta.env.MODE !== "wdio") return;
  await import("@wdio/tauri-plugin");
  const { installWdioHooks } = await import("./wdioHooks");
  installWdioHooks();
}
```

Call and await this before React bootstrap. `wdioHooks.ts` may expose only deterministic test operations on `window.__BLOCKY_SPIKE_TEST__`: get block count, load the 100-block fixture, get canonical snapshot, get manifest, start/cancel simulation, read redacted events, and read `performance.memory.usedJSHeapSize`. It must be absent in normal mode.

- [ ] **Step 4: 建立单独 WDIO Tauri 配置和权限**

`tauri.wdio.conf.json` merges only test settings:

```json
{
  "build": {
    "beforeBuildCommand": "pnpm build:wdio"
  },
  "app": {
    "withGlobalTauri": true,
    "security": {
      "capabilities": ["main", "wdio"]
    }
  }
}
```

`capabilities/wdio.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "wdio",
  "description": "Test-only WebdriverIO capability",
  "windows": ["main"],
  "permissions": ["wdio:default"]
}
```

No normal config or `main` capability references `wdio`.

- [ ] **Step 5: 配置原生 Windows embedded provider**

Create `wdio.conf.ts`:

```ts
export const config = {
  runner: "local",
  specs: ["./tests/e2e/**/*.e2e.ts"],
  maxInstances: 1,
  services: [["@wdio/tauri-service", {
    appBinaryPath: "./src-tauri/target/release/blocky-windows-core-spike.exe",
    driverProvider: "embedded",
    captureBackendLogs: true,
    captureFrontendLogs: true,
    startTimeout: 120_000,
    commandTimeout: 30_000,
  }]],
  capabilities: [{
    browserName: "tauri",
    "tauri:options": {
      application: "./src-tauri/target/release/blocky-windows-core-spike.exe",
    },
  }],
  logLevel: "info",
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 120_000 },
};
```

- [ ] **Step 6: 写完整原生 Core E2E**

The E2E spec must run against the compiled `.exe`, not Vite browser mode, and verify in this order:

1. Empty workspace: builder tab works, runtime tab disabled.
2. Load fixture: `blockCount === 100`; runtime tab becomes enabled.
3. Select two entries and verify separate names/drafts.
4. Verify text/image/file/voice/Skill/plugin controls exactly follow each manifest entry.
5. Collapse one block, zoom in/out, save through the real Rust command, clear, reload, and compare canonical snapshot and all 100 IDs.
6. Normal run yields two chunks and block highlight.
7. Cancel stops without `run.completed`.
8. `/error` produces `MODEL_SIMULATED_FAILURE` at the originating block.
9. `/permission` displays the requested Tool/permissions; deny prevents Tool start; approve yields Tool completion.
10. Override `fetch`, `XMLHttpRequest` and `WebSocket` to throw on outbound use, then repeat load/compile/run to prove no runtime network dependency.

Use normal DOM actions for buttons, tabs, selector, text and save/reload. Use `browser.tauri.execute` only for assertions or setup impossible to express reliably through WebDriver, and document each such use inline.

- [ ] **Step 7: 构建并运行 E2E**

```powershell
pnpm --dir try/windows-core-spike test:e2e:build
pnpm --dir try/windows-core-spike test:e2e
```

Expected: native Windows E2E passes; captured logs contain no unhandled exception or sensitive values.

- [ ] **Step 8: 重新构建普通版本并证明测试能力被剔除**

```powershell
pnpm --dir try/windows-core-spike tauri build --no-bundle
rg -n "wdioTauri|__BLOCKY_SPIKE_TEST__|wdio:default" try/windows-core-spike/dist
cargo tree --manifest-path try/windows-core-spike/src-tauri/Cargo.toml --no-default-features | Select-String -Pattern "tauri-plugin-wdio"
```

Expected: normal build passes; both searches produce no output. If Vite retains a dead WDIO chunk, replace the conditional import with a mode-specific entry alias; do not accept a normal build containing test APIs.

- [ ] **Step 9: 提交任务**

```powershell
git add try/windows-core-spike
git commit -m "spike: verify Windows Core through native E2E"
```

### Task 10: 建立性能、30 分钟稳定性和敏感信息总门禁

**Files:**

- Create: `try/windows-core-spike/tests/e2e/windows-core-performance.e2e.ts`
- Create: `try/windows-core-spike/tests/e2e/windows-core-soak.e2e.ts`
- Create: `try/windows-core-spike/tests/security/repository-sensitive-scan.ps1`
- Create: `try/windows-core-spike/scripts/verify-spike.ps1`
- Modify: `try/windows-core-spike/package.json`
- Modify: `try/windows-core-spike/src/test/wdioHooks.ts`

**Interfaces:**

- Consumes: Task 9 的 native WDIO 通道、测试钩子、真实 Host 存取和测试/普通构建隔离。
- Produces: 三项性能阈值、360-cycle soak、仓库/快照/日志敏感扫描和 `verify-spike.ps1` 单命令门禁。

- [ ] **Step 1: 写量化性能门禁**

`windows-core-performance.e2e.ts` must measure inside the native WebView with `performance.now()`. Run each operation five times after one untimed warm-up and assert the median:

| Operation | Fixture | Pass threshold |
|---|---|---|
| Blockly JSON load | exact 100 blocks | median ≤ 1500 ms |
| Blockly save + stable IR + manifest + Tool compile | exact 100 blocks | median ≤ 750 ms |
| deterministic runtime | 100-node program, no artificial chunk delay | median ≤ 1500 ms |

Use:

```ts
function median(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}
```

The test prints one JSON line with environment, all five samples and medians. It must fail on non-finite values, wrong block count or a threshold breach. Do not raise thresholds after seeing results without recording a design decision and user-visible reason.

Run:

```powershell
pnpm --dir try/windows-core-spike exec wdio run ./wdio.conf.ts --spec ./tests/e2e/windows-core-performance.e2e.ts
```

Expected: PASS with actual metric JSON retained in the command log for the spike report.

- [ ] **Step 2: 写 30 分钟 soak 测试**

The soak must execute 360 cycles at a target interval of five seconds and verify every cycle:

1. workspace block count remains 100;
2. canonical snapshot SHA-256 remains equal to the baseline unless that cycle intentionally toggles collapse state, in which case the next toggle restores it;
3. compile diagnostics contain no errors;
4. one deterministic run reaches exactly one terminal event;
5. every twelfth cycle saves and reloads through the real Rust Host;
6. there are no uncaught errors, unhandled rejections, corrupted JSON or outbound network attempts.

At cycle 60, force a GC opportunity by clearing completed UI event rows to the configured 200-row cap, wait two seconds, and record `performance.memory.usedJSHeapSize` as the warm baseline. At cycle 360, record final heap. Pass only when:

```ts
expect(elapsedMs).toBeGreaterThanOrEqual(30 * 60 * 1000);
expect(finalHeapBytes - warmHeapBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
expect(cyclesCompleted).toBe(360);
expect(saveReloadsCompleted).toBe(30);
```

If `performance.memory.usedJSHeapSize` is unavailable in the pinned Windows WebView2, mark the gate failed and replace it with a documented Windows process working-set measurement before rerunning; do not silently skip memory evidence.

- [ ] **Step 3: 建立仓库与运行产物敏感扫描**

`repository-sensitive-scan.ps1` must inspect tracked text files under `try/windows-core-spike/`, the generated project snapshot and captured frontend/backend logs. It must detect the same categories as `securityScan.ts`. Construct detector literals from fragments so the detector itself does not trigger the scan. Exclude binary executables, PDBs and package archives; do not exclude application source, tests, JSON, logs or reports.

The script exits 0 only when finding count is zero and prints:

```text
SENSITIVE_SCAN tracked=0 snapshot=0 frontend_log=0 backend_log=0
```

Create the runtime snapshot and log files in ignored `artifacts/security-scan/`; delete only that exact generated directory after the counts have been copied into the technical report.

- [ ] **Step 4: 建立单命令验证器**

`verify-spike.ps1` parameters:

```powershell
param(
  [switch]$Fast,
  [switch]$IncludeSoak
)
```

It must stop on first non-zero command, preserve each command's exit code, and run from its own resolved project directory. `-Fast` runs unit, component, TypeScript build, Rust fmt/clippy/test, and the sensitive scan. Default additionally builds the WDIO app and runs Core + performance native E2E. `-IncludeSoak` adds the 30-minute soak after the default set. After every native WDIO run, the script must rebuild the ordinary release with no Cargo feature, rerun the WDIO isolation scans, and leave that ordinary binary as the final artifact.

Change `package.json` scripts to:

```json
{
  "scripts": {
    "check": "pwsh -NoProfile -File ./scripts/verify-spike.ps1 -Fast",
    "check:core": "pwsh -NoProfile -File ./scripts/verify-spike.ps1",
    "check:full": "pwsh -NoProfile -File ./scripts/verify-spike.ps1 -IncludeSoak"
  }
}
```

Merge these keys into the existing `scripts` object; do not replace the earlier dev/build/test scripts.

- [ ] **Step 5: 先跑快速总门禁**

```powershell
pwsh -NoProfile -File .\try\windows-core-spike\scripts\verify-spike.ps1 -Fast
```

Expected: all unit/component/build/Rust/security checks PASS. Fix any warning treated as error rather than suppressing it broadly.

- [ ] **Step 6: 跑原生 Core 与性能总门禁**

```powershell
pwsh -NoProfile -File .\try\windows-core-spike\scripts\verify-spike.ps1
```

Expected: native Core E2E and all three median performance thresholds PASS.

- [ ] **Step 7: 单独启动完整 30 分钟门禁**

Run the command through a yielding process runner so progress can be reported while it remains active:

```powershell
pwsh -NoProfile -File .\try\windows-core-spike\scripts\verify-spike.ps1 -IncludeSoak
```

Expected: elapsed time is at least 30 minutes; all 360 cycles, 30 Host save/reloads and the heap delta gate PASS. A test that exits early, loses the app, or lacks heap evidence is a failure even if earlier checks were green.

- [ ] **Step 8: 进行 Windows 人工交互验收**

Launch the normal release executable, disconnect external network access, and perform this exact checklist:

- drag ten blocks from at least four categories;
- make one valid and one intentionally invalid connection, confirming the latter is rejected;
- collapse and expand Agent, entry and Tool containers;
- zoom in, zoom out and reset zoom;
- load the 100-block fixture, save, close, reopen and reload;
- switch two entries and verify distinct drafts;
- add/remove each of six entry capabilities and compare the right panel;
- run normal, cancel, `/error`, permission deny and permission approve paths;
- verify active block highlighting matches the event timeline.

Record actual results and any visual defect in the task acceptance record. Do not call this step passed from automated evidence alone.

- [ ] **Step 9: 提交任务**

```powershell
git add try/windows-core-spike
git commit -m "test: add Windows Core performance and soak gates"
```

### Task 11: 形成技术结论、模块验收和可追溯报告

**Files:**

- Create: `doc/技术设计/Windows-Core技术尖峰报告.md`
- Modify: `doc/技术设计/ADR-001-首版跨端技术选型.md`
- Modify: `doc/开发/开发环境.md`
- Modify: `README.md`
- Create or modify: `doc/验收/模块/验收-Blocky编辑器与运行核心.md`
- Create: `doc/验收/任务/验收-Windows-Core技术尖峰.md`
- Modify: `doc/进展记录/2026-08-09.md`

**Interfaces:**

- Consumes: Tasks 1–10 的当前 commit、完整命令输出、性能样本、soak 指标、安全扫描和人工交互结果。
- Produces: 技术尖峰 GO/NO-GO 报告、L3 任务验收、长期模块验收、ADR/README/环境文档和精确分钟进展记录。

- [ ] **Step 1: 先建立 L3 任务验收记录**

The task record must have a summary table and detailed report, and include:

- involved modules: Blockly editor, IR compiler, interaction projection, Tool contract, runtime, Tauri Host, Windows E2E;
- level: `L3` because this is the product's core execution and local-data boundary;
- exact commands and exit codes;
- eight ADR gate results;
- actual performance samples/medians and soak counts/duration/heap delta;
- manual checklist results;
- sensitive scan counts;
- residual risks and limitations;
- final conclusion limited to `通过`, `有条件通过`, `不通过`, `阻塞`, or `未执行`.

If any required Core, performance, soak, security or manual item fails, the conclusion cannot be `通过`.

- [ ] **Step 2: 写技术尖峰报告，不把临时代码称为产品**

`Windows-Core技术尖峰报告.md` must contain:

1. date, machine and pinned toolchain;
2. tested commit hash and branch;
3. scope and explicit exclusions;
4. architecture diagram for Blockly JSON → IR → manifest/Tool/runtime → Tauri Host;
5. evidence table mapped to all eight Core gates;
6. measured performance and soak results;
7. permission/CSP/secret findings;
8. defects encountered and fixes;
9. decision: `GO` only if every L3 gate passes, otherwise `NO-GO`;
10. exact consequences for the formal repository structure.

For `GO`, the consequence is permission to design the formal monorepo and shared packages; it is not permission to copy the spike wholesale, ship, publish, charge users or claim full 311-block support.

- [ ] **Step 3: 长期维护模块验收基线**

`doc/验收/模块/验收-Blocky编辑器与运行核心.md` uses feature-level headings and scenario-level subheadings. Include durable scenarios for local Blockly, six connection grammars, stable IR, interaction manifest, Tool identity, runtime events, Host storage and security. Link detailed evidence to the task record instead of copying full logs.

- [ ] **Step 4: 更新 ADR、环境文档和 README**

- ADR-001: set Windows Core spike status to the actual result and link the report; leave stages 2–3 unverified.
- `doc/开发/开发环境.md`: record exact pinned dependencies, `check`, `check:core`, `check:full`, native binary path and that WDIO is test-only.
- README: replace “no runnable prototype” only with truthful wording: a disposable Windows Core technical spike exists; no formal Blocky application or distributable product exists yet.

- [ ] **Step 5: 更新一次进展记录**

Append one local-time range precise to minutes to `doc/进展记录/2026-08-09.md`. If implementation crosses midnight, write the final stage to the actual completion-date file instead. Include completed work, every added/modified/generated source file group and purpose, exact acceptance link/conclusion, errors, work outside the workspace, and the GitHub non-push state. Do not repeat full acceptance details.

- [ ] **Step 6: 验证文档事实与链接并提交**

```powershell
rg -n "GO|NO-GO|100|360|30 分钟|SENSITIVE_SCAN|wdio" README.md doc try/windows-core-spike
git diff --check
```

Manually verify every relative Markdown link resolves. Then:

```powershell
git add README.md doc try/windows-core-spike
git commit -m "docs: record Windows Core spike evidence"
```

### Task 12: 最终复核、归档计划、合并 `main` 并清理任务分支

**Files:**

- Move after all gates pass: `docs/superpowers/plans/2026-08-09-windows-core-spike.md` → `doc/归档/2026-08-09/2026-08-09-windows-core-spike-plan.md`
- Move after acceptance passes: `doc/验收/任务/验收-Windows-Core技术尖峰.md` → `doc/验收/归档/2026-08-09/验收-Windows-Core技术尖峰.md`
- Modify: `doc/进展记录/2026-08-09.md`

**Interfaces:**

- Consumes: Task 11 的 L3 结论和全部新鲜验证证据。
- Produces: 通过时归档的计划/验收、干净本地 `main` 和已删除任务分支；未通过时保留未合并分支及精确失败证据。

- [ ] **Step 1: 运行最终全量门禁，不复用旧日志冒充新结果**

```powershell
pwsh -NoProfile -File .\scripts\check-dev-environment.ps1 -Json
pwsh -NoProfile -File .\try\windows-core-spike\scripts\verify-spike.ps1 -IncludeSoak
git diff --check
git status --short --branch
```

Expected: 26/26 environment checks pass; full spike including a fresh 30-minute soak passes; Git whitespace check passes; only deliberate final documentation moves/updates remain.

- [ ] **Step 2: 执行计划与验收归档**

Only when the task conclusion is `通过`, create `doc/归档/2026-08-09/` if needed and use `git mv` for both files listed above. If execution completes on a later date, use that actual date for both archive directories and update their links. Do not archive on `有条件通过`, `不通过`, `阻塞`, or `未执行`.

- [ ] **Step 3: 最终进展记录引用归档路径并提交**

Update the progress entry with the final acceptance path and conclusion, then:

```powershell
git add README.md doc docs try/windows-core-spike .gitignore
git commit -m "chore: finalize Windows Core spike acceptance"
git status --short --branch
```

Expected: task branch is clean.

- [ ] **Step 4: 仅在 L3 通过时快进合并本地 `main`**

```powershell
git switch main
git merge --ff-only codex/feat-windows-core-spike
git branch -d codex/feat-windows-core-spike
git status --short --branch
```

Expected: local `main` clean, task branch deleted, spike evidence and archived plan reachable from `main`.

If L3 is not `通过`, do not merge or delete the branch. Report the failing command, observed result, attempts, current blocker and recommended next repair.

- [ ] **Step 5: 核对远端但不自动推送**

```powershell
git fetch origin
git status --short --branch
git log --oneline origin/main..main
```

Expected: report exactly how many local commits are ahead. Do not run `git push`; the private GitHub remote requires a separate explicit user authorization for this push.

## Completion Definition

The Windows Core spike is complete only when all of these are simultaneously true:

- exact 100-block native project survives edit/save/close/reopen without identity or semantic loss;
- stable IR is byte-deterministic for semantic-equivalent workspace states;
- runtime events map only to real stable block IDs;
- zero/single/multiple interaction entries, default naming, rename, reorder, drafts and six capabilities behave as specified;
- Tool attachment and explicit call resolve one stable contract;
- normal stream, cancel, error, approval and denial are deterministic and visible;
- Tauri Host refuses arbitrary paths, oversize/invalid/sensitive snapshots and uses atomic writes;
- normal build contains no WDIO capability or test hook;
- native Windows E2E, performance thresholds, a fresh 30-minute soak, sensitive scans and manual checklist all pass;
- L3 task acceptance conclusion is `通过`, plan and task acceptance are archived, local `main` is clean, and no unapproved GitHub push occurred.

## Official References Used by the Plan

- Tauri project creation: <https://v2.tauri.app/start/create-project/>
- Tauri command boundary: <https://v2.tauri.app/develop/calling-rust/>
- Tauri capabilities: <https://v2.tauri.app/security/capabilities/>
- Tauri CSP: <https://v2.tauri.app/security/csp/>
- Tauri testing overview: <https://v2.tauri.app/develop/tests/>
- Tauri WebDriver testing: <https://v2.tauri.app/develop/tests/webdriver/>
- WebdriverIO Tauri plugin setup: <https://webdriver.io/docs/desktop-testing/tauri/plugin-setup/>
- Blockly JSON serialization: <https://developers.google.com/blockly/guides/configure/web/serialization>
- Blockly connection checks: <https://developers.google.com/blockly/guides/create-custom-blocks/inputs/connection-check-playbook>
- Vite Node.js compatibility: <https://vite.dev/guide/>
