import type { Studio } from "../composition/useStudio";
import { startingBlueprints } from "@blocky/block-catalog";

const descriptions: Record<(typeof startingBlueprints)[number]["id"], string> = {
  "knowledge-assistant": "连接并同步资料，让回答带上可核对的来源。",
  "work-assistant": "在你选择的工作目录中整理资料并交付结果。",
  "coding-assistant": "在授权仓库里读、改、检查并保留差异。",
  "pi-agent": "配置模型和工具，搭建可自定义的 Agent。",
};

export function Welcome({ studio: s }: { studio: Studio }) {
  const creatingDisabled = s.busy || !s.settings.ready || !s.resources.ready;
  return (
    <section className="welcome">
      {(s.recovery.candidate || s.recovery.error) && (
        <section role="alert" className="recovery-notice">
          <h2>发现未保存作品</h2>
          <p>
            {s.recovery.error ||
              `${s.recovery.candidate?.project.manifest.displayName} · ${s.recovery.candidate?.record.updatedAt}`}
          </p>
          {s.recovery.candidate && (
            <button onClick={s.restoreRecovery}>恢复为未保存副本</button>
          )}
          <button
            onClick={() =>
              void s
                .confirm("放弃此恢复副本？已保存的项目文件不受影响。")
                .then(async (yes) => {
                  if (yes) await s.recovery.discard();
                })
                .catch(() => s.setMessage("恢复副本未能清除。"))
            }
          >
            放弃恢复副本
          </button>
        </section>
      )}
      <div className="welcome-heading">
        <span className="eyebrow">把想法搭起来</span>
        <h1>
          从一个问题，
          <br />
          开始创作。
        </h1>
        <p>用积木组合角色、资料和工具，构建你的 AI 项目。</p>
        <div className="welcome-actions">
          <button className="primary" disabled={creatingDisabled} onClick={s.fresh}>
            新建空白项目
          </button>
          <button onClick={() => void s.open()}>打开本机项目</button>
        </div>
      </div>
      <section aria-label="内置起始蓝图" style={{ flex: "1 1 420px", minWidth: 0, maxWidth: 560 }}>
        <h2>选择一个起点</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          {startingBlueprints.map((blueprint) => (
            <button
              key={blueprint.id}
              aria-label={`从${blueprint.displayName}开始`}
              disabled={creatingDisabled}
              onClick={() => void s.startBlueprint(blueprint.id)}
              style={{ display: "grid", gap: 6, textAlign: "left", padding: 14 }}
            >
              <strong>{blueprint.displayName}</strong>
              <span>{descriptions[blueprint.id]}</span>
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}
