import { describe, expect, it } from "vitest";
import {
  attachCourseCitations,
  createCourseModelResult,
  formatCourseMarkdown,
  generateDeterministicCourseModel,
  guardCourseModelResult,
  parseCourseDraft,
  planCourseQuestion,
  rerankCourseEvidence,
  retrieveCourseKnowledge,
} from "../../src/core/deterministicCourseAgent";

describe("deterministic course evidence adapter", () => {
  it("retrieves evidence across multiple topics without encoding one fixed question", () => {
    const plan = planCourseQuestion(
      "请分别解释树叶秋天变红和水循环形成降雨的原因，并引用课程资料。",
    );
    const context = retrieveCourseKnowledge(plan, "knowledge.course.primary-science");

    expect(context.evidence.map((chunk) => chunk.id)).toEqual([
      "autumn-leaves:2",
      "water-cycle:1",
    ]);
  });

  it("reranks evidence by question relevance and removes duplicate chunks", () => {
    const plan = planCourseQuestion("水循环为什么会形成降雨？");
    const context = retrieveCourseKnowledge(plan, "knowledge.course.primary-science");
    const ranked = rerankCourseEvidence({
      ...context,
      evidence: [
        {
          id: "autumn-leaves:2",
          title: "《秋天的叶子》",
          section: "§2",
          heading: "树叶为什么会在秋天变红",
          text: "叶绿素逐渐分解。",
          highlightLabel: "关键过程",
          highlight: "叶绿素分解",
          keywords: ["树叶", "秋天"],
        },
        ...context.evidence,
        ...context.evidence,
      ],
    });

    expect(ranked.evidence.map((chunk) => chunk.id)).toEqual(["water-cycle:1"]);
    expect(ranked.schema).toBe("blocky.course-ranked-context/v1");
  });

  it("answers an independent photosynthesis question without leaking other topics", () => {
    const plan = planCourseQuestion("绿色植物怎样通过光合作用制造养分？");
    const context = retrieveCourseKnowledge(plan, "knowledge.course.primary-science");
    const draft = parseCourseDraft(
      generateDeterministicCourseModel(JSON.stringify(rerankCourseEvidence(context))) ?? "",
    );

    expect(draft).not.toBeNull();
    const answer = formatCourseMarkdown(attachCourseCitations(
      guardCourseModelResult(createCourseModelResult(rerankCourseEvidence(context), draft!)),
    ));
    expect(answer).toContain("## 课程资料综合回答");
    expect(answer).toContain("### 1. 光合作用怎样制造养分");
    expect(answer).toContain("- **课程依据：** [《植物怎样获得养分》§1]");
    expect(answer).not.toMatch(/叶绿素|水蒸气|降雨/);
  });

  it("marks an unsupported requested detail instead of inventing a domain answer", () => {
    const plan = planCourseQuestion("课程资料是否说明树叶开始变红的具体摄氏温度？");
    const context = retrieveCourseKnowledge(plan, "knowledge.course.primary-science");
    const draft = parseCourseDraft(
      generateDeterministicCourseModel(JSON.stringify(rerankCourseEvidence(context))) ?? "",
    );

    expect(context.evidence).toHaveLength(0);
    expect(draft).not.toBeNull();
    expect(formatCourseMarkdown(attachCourseCitations(
      guardCourseModelResult(createCourseModelResult(rerankCourseEvidence(context), draft!)),
    )))
      .toContain("- **树叶开始变红的具体摄氏温度：** 待核实");
  });

  it("formats a multi-topic answer as titled Markdown with evidence and completeness sections", () => {
    const plan = planCourseQuestion(
      "请分别解释树叶秋天变红和水循环形成降雨的原因；课程资料是否说明树叶开始变红的具体摄氏温度？",
    );
    const context = rerankCourseEvidence(
      retrieveCourseKnowledge(plan, "knowledge.course.primary-science"),
    );
    const draft = parseCourseDraft(generateDeterministicCourseModel(JSON.stringify(context)) ?? "");
    const answer = formatCourseMarkdown(attachCourseCitations(
      guardCourseModelResult(createCourseModelResult(context, draft!)),
    ));

    expect(answer).toContain("## 课程资料综合回答");
    expect(answer).toContain("### 1. 树叶为什么会在秋天变红");
    expect(answer).toContain("### 2. 水循环为什么会形成降雨");
    expect(answer).toContain("### 3. 资料完整性检查");
    expect(answer).toContain("- **关键过程：** 叶绿素分解、其他色素显现");
    expect(answer).toContain("- **过程链：** 蒸发 → 凝结 → 降水");
    expect(answer).toContain("- **课程依据：** [《秋天的叶子》§2]");
    expect(answer).toContain("- **树叶开始变红的具体摄氏温度：** 待核实");
  });

  it("does not treat nonnumeric temperature wording as an exact temperature answer", () => {
    const ranked = rerankCourseEvidence({
      schema: "blocky.course-evidence-context/v1",
      sourceId: "knowledge.course.primary-science",
      question: "树叶开始变红的具体摄氏温度是多少？",
      queries: [],
      requestedDetails: ["树叶开始变红的具体摄氏温度"],
      evidence: [{
        id: "temperature-without-number",
        title: "《测试资料》",
        section: "§1",
        heading: "只有趋势没有数值",
        text: "资料只说温度降低会影响叶片，但没有给出数值。",
        highlightLabel: "资料状态",
        highlight: "只有趋势",
        keywords: ["树叶", "温度"],
      }],
    });

    expect(ranked.evidence).toEqual([]);
  });

  it("fails a fabricated model citation closed against the trusted evidence context", () => {
    const context = rerankCourseEvidence(retrieveCourseKnowledge(
      planCourseQuestion("树叶为什么会在秋天变红？"),
      "knowledge.course.primary-science",
    ));
    const answer = guardCourseModelResult(createCourseModelResult(context, {
      schema: "blocky.course-draft/v1",
      question: context.question,
      claims: [{
        kind: "evidence",
        text: "树叶在十摄氏度时一定变红。",
        subject: "伪造结论",
        highlightLabel: "伪造数值",
        highlight: "十摄氏度",
        citation: {
          evidenceId: "fabricated:1",
          title: "《不存在的资料》",
          section: "§9",
        },
      }],
    }));
    const cited = attachCourseCitations(answer);

    expect(cited.claims[0]).toMatchObject({ supported: false, citationLabel: null });
    expect(cited.claims[0]?.text).toContain("待核实");
    expect(formatCourseMarkdown(cited)).not.toMatch(/十摄氏度|不存在的资料/);
  });
});
