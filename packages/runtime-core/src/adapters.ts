import type { Resource } from "@blocky/language-schema";
import type { EvidenceCitation } from "@blocky/knowledge-core";
export type Citation = { id: string; title: string; text: string } & Partial<
  Omit<EvidenceCitation, "id" | "title" | "text">
>;
export type CompositionInput = {
  question: string;
  role: string;
  citations: Citation[];
};
export type Adapters = {
  knowledge: Map<
    string,
    (
      question: string,
      collection: string,
      signal: AbortSignal,
      context: { projectId: string; resource: Resource },
    ) => Promise<Citation[] | { citations: Citation[]; summary: string }>
  >;
  model: Map<
    string,
    (input: CompositionInput, signal: AbortSignal) => Promise<Citation[]>
  >;
};
const documents = [
  {
    id: "water-cycle",
    collection: "science",
    keywords: ["水循环", "降雨", "下雨", "蒸发"],
    title: "《水循环》§1",
    text: "水受热蒸发成为水蒸气，遇冷凝结成水滴，形成云并通过降水回到地面。",
  },
  {
    id: "leaves",
    collection: "science",
    keywords: ["树叶", "秋叶", "变黄", "变色"],
    title: "《秋天的叶子》§2",
    text: "秋季叶绿素逐渐分解，原先被遮盖的其他色素显现，因此部分叶片呈现黄色或红色。",
  },
  {
    id: "photosynthesis",
    collection: "science",
    keywords: ["光合作用", "氧气", "植物"],
    title: "《植物的营养》§1",
    text: "绿色植物利用光能，将水和二氧化碳转化为有机物，并释放氧气。",
  },
  {
    id: "blocky-save",
    collection: "blocky",
    keywords: ["保存", "项目", "画布"],
    title: "《Blocky 使用资料》§1",
    text: "项目保存模块与积木内容。标签和面板布局属于本机会话，关闭标签不会删除画布。",
  },
];
export function localAdapters(): Adapters {
  return {
    knowledge: new Map([
      [
        "adapter://deterministic/knowledge-v1",
        async (question, collection, signal) => {
          signal.throwIfAborted();
          if (/精确|具体.*温度|多少度|具体摄氏/.test(question)) return [];
          return documents
            .filter(
              (d) =>
                d.collection === collection &&
                d.keywords.some((k) => question.includes(k)),
            )
            .map(({ id, title, text }) => ({ id, title, text }));
        },
      ],
    ]),
    model: new Map([
      [
        "adapter://deterministic/composer-v1",
        async (input, signal) => {
          signal.throwIfAborted();
          return input.citations;
        },
      ],
    ]),
  };
}
export function renderAnswer(
  citations: Citation[],
  style: string,
  role: string,
): string {
  if (!citations.length) return "课程资料没有说明，待核实。";
  // Retrieval similarity does not establish that a passage answers the question.
  // The local composer can quote evidence, but has no entailment/answer generator.
  if (citations.some((c) => c.collectionId)) {
    const excerpts = citations.map((c) => `${c.text} [${c.title}]`);
    return (
      "相关资料摘录\n\n" +
      (style === "段落"
        ? excerpts.join("\n\n")
        : excerpts.map((s) => `• ${s}`).join("\n")) +
      "\n\n这些是原文摘录，尚不能确认完整回答了问题。若缺少所问的信息，请补充资料或说明要核对的内容；未说明的事实仍待核实。"
    );
  }
  const title = role.includes("教师")
    ? "学习要点"
    : role.includes("研究")
      ? "资料结论"
      : "资料回答";
  const parts = citations.map((c) => `${c.text} [${c.title}]`);
  return (
    `${title}\n\n` +
    (style === "段落"
      ? parts.join("\n\n")
      : parts.map((x) => `• ${x}`).join("\n"))
  );
}
