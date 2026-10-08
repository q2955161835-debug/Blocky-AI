import { useEffect, useState } from "react";
import { resolveSetting } from "@blocky/settings-core";
import type { Studio } from "../composition/useStudio";
import type { CodingAgent } from "../composition/useCodingAgent";
import { SettingsShell } from "./settings/SettingsShell";
import { SettingsRow, SettingsGroup } from "./settings/SettingsRow";
import { PreferenceRows } from "./settings/PreferenceRows";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import {
  settingsSections,
  type SettingsSection,
} from "./settings/settingsNavigation";
import { ResourcePanel } from "./ResourcePanel";
import { BuilderModelSettings } from "./BuilderModelSettings";
import { RunSettings } from "./RunSettings";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { ProjectMap } from "./ProjectMap";
import { EditorTools } from "./EditorTools";
import { Inspector } from "./Inspector";
const searchTerms: Record<SettingsSection, string> = {
  general: "视图 专业 入门 最小化 托盘 工作台 布局 左侧 右侧 宽度",
  appearance:
    "主题 深色 浅色 跟随系统 界面字号 界面字体 代码字体 微软雅黑 宋体 Consolas Courier 减少动态",
  models:
    "默认模型 厂商 连接 模型 ID 超时 Token 温度 工具 MCP 知识 记忆 技能 媒体 评估 触发器",
  builder: "构建助手 模型 工具调用 工作文件夹 权限",
  agent:
    "作品运行 Blocky Agent 模型 预算 入口 断点 调试 单步 项目画布 积木 属性 工作流",
  shortcuts: "快捷键 搜索 命令 导入 导出 恢复",
  advanced: "专业 终端 输出 容量 字节 日志 保留 天数 存储",
};
export function SettingsPanel({
  studio: s,
  builder,
  initialSection = "general",
  execute = () => {},
  enabled = () => true,
  onClose,
  onDirty,
}: {
  studio: Studio;
  builder?: CodingAgent;
  initialSection?: SettingsSection;
  execute?(id: string): void;
  enabled?(id: string): boolean;
  onClose?(): void;
  onDirty?(dirty: boolean): void;
}) {
  const [section, setSection] = useState(initialSection),
    [query, setQuery] = useState("");
  const [visited, setVisited] = useState<SettingsSection[]>([initialSection]);
  useEffect(() => {
    setSection(initialSection);
    setVisited((v) =>
      v.includes(initialSection) ? v : [...v, initialSection],
    );
  }, [initialSection]);
  const select = (next: SettingsSection) => {
    setSection(next);
    setQuery("");
    setVisited((v) => (v.includes(next) ? v : [...v, next]));
  };
  const defaultModel = resolveSetting(
    "models.defaultResourceId",
    s.settings.layers,
  ).value;
  const builderModel = s.settings.ui.values.builderModelId || defaultModel;
  const filtered = settingsSections.filter((item) =>
    (
      item.title +
      " " +
      searchTerms[item.id] +
      (item.id === "models"
        ? " " +
          s.resources.registry.providers.map((p) => p.displayName).join(" ") +
          " " +
          s.resources.registry.resources.map((r) => r.displayName).join(" ")
        : "")
    )
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <SettingsShell
      section={section}
      onSection={select}
      query={query}
      onQuery={setQuery}
      onClose={onClose}
    >
      {query.trim() && (
        <div className="settings-search-results" aria-label="设置搜索结果">
          {filtered.length ? (
            filtered.map((item) => (
              <button key={item.id} onClick={() => select(item.id)}>
                {item.title}
                <small>{searchTerms[item.id]}</small>
              </button>
            ))
          ) : (
            <p>没有找到匹配设置。</p>
          )}
        </div>
      )}
      {visited.map((id) => (
        <div key={id} hidden={id !== section || !!query.trim()}>
          {id === "general" && (
            <>
              <SettingsGroup title="常规">
                <PreferenceRows
                  studio={s}
                  ids={["ui.view", "window.minimizeToTray"]}
                />
              </SettingsGroup>
              <SettingsGroup title="工作台布局">
                <SettingsRow title="左侧积木库宽度">
                  <input
                    aria-label="左侧积木库宽度"
                    type="range"
                    min="180"
                    max="1200"
                    value={s.session.leftWidth}
                    onChange={(e) =>
                      s.setSession((v) => ({
                        ...v,
                        leftWidth: Number(e.target.value),
                      }))
                    }
                  />
                </SettingsRow>
                <SettingsRow title="右侧面板宽度">
                  <input
                    aria-label="右侧面板宽度"
                    type="range"
                    min="240"
                    max="1200"
                    value={s.session.rightWidth}
                    onChange={(e) =>
                      s.setSession((v) => ({
                        ...v,
                        rightWidth: Number(e.target.value),
                      }))
                    }
                  />
                </SettingsRow>
                <SettingsRow title="恢复布局">
                  <button onClick={s.resetLayout}>恢复默认工作台布局</button>
                </SettingsRow>
              </SettingsGroup>
            </>
          )}
          {id === "appearance" && <AppearanceSettings studio={s} />}
          {id === "models" && (
            <>
              <SettingsGroup title="默认模型">
                <PreferenceRows studio={s} ids={["models.defaultResourceId"]} />
              </SettingsGroup>
              <ResourcePanel studio={s} unified onDirty={onDirty} />
            </>
          )}
          {id === "builder" && (
            <>
              <SettingsGroup title="模型">
                <BuilderModelSettings
                  studio={s}
                  resourceId={builderModel}
                  disabled={
                    !s.settings.ui.ready ||
                    !!builder?.busy ||
                    s.running ||
                    s.busy
                  }
                  select={(value) =>
                    s.settings.ui.change("builderModelId", value)
                  }
                  configure={() => select("models")}
                />
                <SettingsRow title="跟随默认模型">
                  <button
                    disabled={!s.settings.ui.ready}
                    onClick={() => s.settings.ui.change("builderModelId", "")}
                  >
                    恢复默认模型
                  </button>
                </SettingsRow>
              </SettingsGroup>
              <SettingsGroup title="工作文件夹">
                <SettingsRow
                  title="当前文件夹"
                  description={builder?.workspace?.displayName || "尚未选择"}
                >
                  <button
                    disabled={!builder || builder.busy || s.running || s.busy}
                    onClick={() => void builder?.pickWorkspace()}
                  >
                    选择工作文件夹
                  </button>
                </SettingsRow>
              </SettingsGroup>
            </>
          )}
          {id === "agent" && (
            <>
              <SettingsGroup title="运行与调试">
                <RunSettings studio={s} execute={execute} />
              </SettingsGroup>
              <SettingsGroup title="画布与积木">
                <ProjectMap studio={s} />
                <EditorTools studio={s} execute={execute} enabled={enabled} />
                <Inspector
                  studio={s}
                  configureResource={() => select("models")}
                />
              </SettingsGroup>
            </>
          )}
          {id === "shortcuts" && (
            <SettingsGroup title="键盘快捷键">
              <ShortcutsPanel studio={s} />
            </SettingsGroup>
          )}
          {id === "advanced" && (
            <SettingsGroup title="输出与日志">
              <PreferenceRows
                studio={s}
                ids={[
                  "terminal.outputBudgetBytes",
                  "logs.retentionDays",
                  "logs.maxStoredBytes",
                ]}
              />
            </SettingsGroup>
          )}
        </div>
      ))}
    </SettingsShell>
  );
}
