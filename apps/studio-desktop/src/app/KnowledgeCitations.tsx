import { useEffect, useRef, useState } from "react";
import {
  KnowledgeSearch,
  type KnowledgeCall,
  type EvidenceCitation,
} from "@blocky/knowledge-core";
export function KnowledgeCitations({
  citations,
  projectId,
  call,
}: {
  citations: EvidenceCitation[];
  projectId: string;
  call: KnowledgeCall;
}) {
  const [opened, setOpened] = useState<{ title: string; text: string }>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setOpened(undefined);
    setError("");
    setBusy(false);
    return () => {
      epoch.current++;
    };
  }, [citations]);
  const open = async (c: EvidenceCitation) => {
    const current = ++epoch.current;
    setBusy(true);
    setError("");
    setOpened(undefined);
    try {
      if (!c.collectionId) throw Error();
      const document = await new KnowledgeSearch(
        call,
        projectId,
        c.collectionId,
      ).openCitation(c);
      if (current === epoch.current)
        setOpened({ title: c.title, text: document.text });
    } catch {
      if (current === epoch.current)
        setError("出处已变化、被移除或无权访问，请同步资料后重新查询。");
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  };
  return (
    <div className="knowledge-citations">
      {citations.map((c) => (
        <article key={c.id}>
          <strong>{c.title}</strong>
          <p>{c.text}</p>
          {c.truncated && <small>已按上下文预算截取；可打开全文。</small>}
          <button disabled={busy} onClick={() => void open(c)}>
            打开出处
          </button>
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
      {opened && (
        <section aria-label="资料出处">
          <h4>{opened.title}</h4>
          <pre className="citation-source">{opened.text}</pre>
          <button onClick={() => setOpened(undefined)}>收起出处</button>
        </section>
      )}
    </div>
  );
}
