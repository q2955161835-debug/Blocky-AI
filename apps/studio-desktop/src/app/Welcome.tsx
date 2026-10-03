import type { Studio } from "../composition/useStudio";
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
            ＋ 新建项目
          </button>
          <button onClick={() => void s.open()}>打开本机项目</button>
        </div>
      </div>
    </section>
  );
}
