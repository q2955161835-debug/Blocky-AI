import type { Studio } from "../composition/useStudio";
export function Welcome({ studio: s }: { studio: Studio }) {
  return (
    <section className="welcome">
      <div className="welcome-heading">
        <span className="eyebrow">把想法搭起来</span>
        <h1>
          从一个问题，
          <br />
          开始创作。
        </h1>
        <p>用积木组合角色、资料和工具，构建你的 AI 项目。</p>
        <div className="welcome-actions">
          <button className="primary" onClick={s.fresh}>
            ＋ 新建项目
          </button>
          <button onClick={() => void s.open()}>打开本机项目</button>
        </div>
      </div>
      <button className="starter-card" onClick={s.fresh}>
        <div className="mini-blocks">
          <span>收到问题</span>
          <span>查找资料</span>
          <span>组织回答</span>
        </div>
        <small>从蓝图开始</small>
        <h2>
          资料问答伙伴 <span>↗</span>
        </h2>
        <p>选择角色与资料，让每个回答都有出处。</p>
        <footer>
          2 个画布 <span>知识 · 工具 · 回答</span>
        </footer>
      </button>
    </section>
  );
}
