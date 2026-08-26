export interface CourseQueryPlan {
  readonly schema: "blocky.course-query-plan/v1";
  readonly question: string;
  readonly queries: readonly string[];
  readonly requestedDetails: readonly string[];
}

export interface CourseEvidenceChunk {
  readonly id: string;
  readonly title: string;
  readonly section: string;
  readonly heading: string;
  readonly text: string;
  readonly highlightLabel: string;
  readonly highlight: string;
  readonly keywords: readonly string[];
}

export interface CourseEvidenceContext {
  readonly schema: "blocky.course-evidence-context/v1";
  readonly sourceId: string;
  readonly question: string;
  readonly queries: readonly string[];
  readonly requestedDetails: readonly string[];
  readonly evidence: readonly CourseEvidenceChunk[];
}

export interface RankedCourseEvidenceContext {
  readonly schema: "blocky.course-ranked-context/v1";
  readonly sourceId: string;
  readonly question: string;
  readonly requestedDetails: readonly string[];
  readonly evidence: readonly CourseEvidenceChunk[];
}

export interface CourseCitation {
  readonly evidenceId: string;
  readonly title: string;
  readonly section: string;
}

export interface CourseDraftClaim {
  readonly kind: "evidence" | "unverified";
  readonly text: string;
  readonly subject: string | null;
  readonly highlightLabel: string | null;
  readonly highlight: string | null;
  readonly citation: CourseCitation | null;
}

export interface CourseDraft {
  readonly schema: "blocky.course-draft/v1";
  readonly question: string;
  readonly claims: readonly CourseDraftClaim[];
}

export interface CourseModelResult {
  readonly schema: "blocky.course-model-result/v1";
  readonly context: RankedCourseEvidenceContext;
  readonly draft: CourseDraft;
}

export interface GuardedCourseClaim extends CourseDraftClaim {
  readonly supported: boolean;
}

export interface GuardedCourseAnswer {
  readonly schema: "blocky.course-guarded-answer/v1";
  readonly question: string;
  readonly claims: readonly GuardedCourseClaim[];
}

export interface CitedCourseClaim extends GuardedCourseClaim {
  readonly citationLabel: string | null;
}

export interface CitedCourseAnswer {
  readonly schema: "blocky.course-cited-answer/v1";
  readonly question: string;
  readonly claims: readonly CitedCourseClaim[];
}

export const PRIMARY_SCIENCE_SOURCE_ID = "knowledge.course.primary-science";

const PRIMARY_SCIENCE_EVIDENCE: readonly CourseEvidenceChunk[] = Object.freeze([
  Object.freeze({
    id: "autumn-leaves:2",
    title: "《秋天的叶子》",
    section: "§2",
    heading: "树叶为什么会在秋天变红",
    text: "秋天气温降低、日照时间变短后，叶绿素逐渐分解，原本被绿色遮住的黄色和橙色色素开始显现。部分树种还会积累花青素，因此叶片可能呈现红色；不同树种和环境条件会使颜色表现不同。",
    highlightLabel: "关键过程",
    highlight: "叶绿素分解、其他色素显现",
    keywords: Object.freeze(["树叶", "叶片", "秋天", "变红", "叶绿素", "花青素"]),
  }),
  Object.freeze({
    id: "water-cycle:1",
    title: "《水循环》",
    section: "§1",
    heading: "水循环为什么会形成降雨",
    text: "太阳能使地表水蒸发成水蒸气。水蒸气上升并冷却后凝结成小水滴，小水滴聚集形成云；当水滴变得足够大、空气托不住时，就会以降雨等形式落回地面。",
    highlightLabel: "过程链",
    highlight: "蒸发 → 凝结 → 降水",
    keywords: Object.freeze(["水循环", "降雨", "下雨", "蒸发", "水蒸气", "凝结"]),
  }),
  Object.freeze({
    id: "photosynthesis:1",
    title: "《植物怎样获得养分》",
    section: "§1",
    heading: "光合作用怎样制造养分",
    text: "绿色植物在光照下利用二氧化碳和水制造养分，并释放氧气。光能驱动这个过程，因此光照、二氧化碳和水都是课程资料中明确提到的条件。",
    highlightLabel: "输入与产物",
    highlight: "光照 + 二氧化碳 + 水 → 养分 + 氧气",
    keywords: Object.freeze(["绿色植物", "植物", "光合作用", "制造养分", "养分", "二氧化碳", "氧气"]),
  }),
]);

const REQUESTED_DETAIL_PATTERN = /多少\s*(?:摄氏)?度|具体(?:的)?(?:摄氏)?温度|具体在多少\s*(?:摄氏)?度/u;
const TEMPERATURE_DETAIL_PATTERN = /温度|摄氏|多少\s*度/u;

function splitQuestion(question: string): string[] {
  return question
    .split(/[，,。；;？?\n]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function isPolicyOnly(part: string): boolean {
  const containsTaskQuestion = /解释|原因|为什么|为何|怎样|如何|多少|具体/u.test(part);
  if (containsTaskQuestion) return false;
  return /引用课程资料|标注.*待核实|没有说明就|每个结论/u.test(part);
}

function normalizeDetailSubject(part: string): string {
  return part
    .replace(/^请(?:问)?/u, "")
    .replace(/^课程资料(?:中)?(?:是否|有没有)?说明/u, "")
    .replace(/^(?:是否|有没有)说明/u, "")
    .replace(/[“”"'。；;？?]+$/gu, "")
    .trim();
}

function normalizeUnknownSubject(question: string): string {
  return question.replace(/[“”"'。；;？?]+$/gu, "").trim();
}

export function planCourseQuestion(question: string): CourseQueryPlan {
  const normalizedQuestion = question.trim();
  const parts = splitQuestion(normalizedQuestion);
  const requestedDetails = parts
    .filter((part) => REQUESTED_DETAIL_PATTERN.test(part))
    .map(normalizeDetailSubject);
  const queries = parts.filter((part) =>
    !REQUESTED_DETAIL_PATTERN.test(part) && !isPolicyOnly(part),
  );

  return Object.freeze({
    schema: "blocky.course-query-plan/v1",
    question: normalizedQuestion,
    queries: Object.freeze(queries.length > 0 || requestedDetails.length > 0
      ? queries
      : [normalizedQuestion]),
    requestedDetails: Object.freeze(requestedDetails),
  });
}

export function isCourseQueryPlan(value: unknown): value is CourseQueryPlan {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CourseQueryPlan>;
  return candidate.schema === "blocky.course-query-plan/v1" &&
    typeof candidate.question === "string" &&
    Array.isArray(candidate.queries) &&
    Array.isArray(candidate.requestedDetails);
}

function evidenceScore(chunk: CourseEvidenceChunk, query: string): number {
  return chunk.keywords.reduce((score, keyword) =>
    query.includes(keyword) ? score + keyword.length : score, 0);
}

function supportsRequestedDetail(chunk: CourseEvidenceChunk, detail: string): boolean {
  if (TEMPERATURE_DETAIL_PATTERN.test(detail)) {
    return /\d+(?:\.\d+)?\s*(?:摄氏(?:度)?|°\s*C|度)/iu.test(chunk.text);
  }
  return evidenceScore(chunk, detail) > 0;
}

export function retrieveCourseKnowledge(
  plan: CourseQueryPlan,
  sourceId: string,
): CourseEvidenceContext {
  const query = plan.queries.join(" ");
  const evidence = sourceId === PRIMARY_SCIENCE_SOURCE_ID
    ? PRIMARY_SCIENCE_EVIDENCE
      .map((chunk, index) => ({
        chunk,
        index,
        score: plan.queries.length > 0
          ? evidenceScore(chunk, query)
          : plan.requestedDetails.reduce((score, detail) =>
            supportsRequestedDetail(chunk, detail) ? score + 1 : score, 0),
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, 4)
      .map(({ chunk }) => chunk)
    : [];

  return Object.freeze({
    schema: "blocky.course-evidence-context/v1",
    sourceId,
    question: plan.question,
    queries: plan.queries,
    requestedDetails: plan.requestedDetails,
    evidence: Object.freeze([...evidence]),
  });
}

export function isCourseEvidenceContext(value: unknown): value is CourseEvidenceContext {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CourseEvidenceContext>;
  return candidate.schema === "blocky.course-evidence-context/v1" &&
    typeof candidate.sourceId === "string" &&
    typeof candidate.question === "string" &&
    Array.isArray(candidate.queries) &&
    Array.isArray(candidate.requestedDetails) &&
    Array.isArray(candidate.evidence);
}

function firstKeywordPosition(chunk: CourseEvidenceChunk, question: string): number {
  const positions = chunk.keywords
    .map((keyword) => question.indexOf(keyword))
    .filter((position) => position >= 0);
  return positions.length > 0 ? Math.min(...positions) : Number.MAX_SAFE_INTEGER;
}

export function rerankCourseEvidence(
  context: CourseEvidenceContext,
): RankedCourseEvidenceContext {
  const query = context.queries.join(" ");
  const unique = new Map<string, CourseEvidenceChunk>();
  for (const chunk of context.evidence) {
    if (!unique.has(chunk.id)) unique.set(chunk.id, chunk);
  }
  const evidence = [...unique.values()]
    .map((chunk, index) => ({
      chunk,
      index,
      position: firstKeywordPosition(chunk, context.question),
      score: context.queries.length > 0
        ? evidenceScore(chunk, query)
        : context.requestedDetails.reduce((score, detail) =>
          supportsRequestedDetail(chunk, detail) ? score + 1 : score, 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) =>
      left.position - right.position || right.score - left.score || left.index - right.index)
    .slice(0, 4)
    .map(({ chunk }) => chunk);

  return Object.freeze({
    schema: "blocky.course-ranked-context/v1",
    sourceId: context.sourceId,
    question: context.question,
    requestedDetails: context.requestedDetails,
    evidence: Object.freeze(evidence),
  });
}

export function isRankedCourseEvidenceContext(
  value: unknown,
): value is RankedCourseEvidenceContext {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RankedCourseEvidenceContext>;
  return candidate.schema === "blocky.course-ranked-context/v1" &&
    typeof candidate.sourceId === "string" &&
    typeof candidate.question === "string" &&
    Array.isArray(candidate.requestedDetails) &&
    Array.isArray(candidate.evidence);
}

export function buildCourseModelRequest(context: RankedCourseEvidenceContext): string {
  return JSON.stringify(context);
}

export function generateDeterministicCourseModel(input: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    return null;
  }
  if (!isRankedCourseEvidenceContext(parsed)) return null;

  const claims: CourseDraftClaim[] = parsed.evidence.map((chunk) => ({
    kind: "evidence",
    text: chunk.text,
    subject: chunk.heading,
    highlightLabel: chunk.highlightLabel,
    highlight: chunk.highlight,
    citation: { evidenceId: chunk.id, title: chunk.title, section: chunk.section },
  }));
  for (const detail of parsed.requestedDetails) {
    if (parsed.evidence.some((chunk) => supportsRequestedDetail(chunk, detail))) continue;
    claims.push({
      kind: "unverified",
      text: `模型草稿声称“${detail}”已有确定答案。`,
      subject: detail,
      highlightLabel: null,
      highlight: null,
      citation: null,
    });
  }
  if (claims.length === 0) {
    claims.push({
      kind: "unverified",
      text: `模型草稿尝试回答“${parsed.question}”。`,
      subject: normalizeUnknownSubject(parsed.question),
      highlightLabel: null,
      highlight: null,
      citation: null,
    });
  }

  return JSON.stringify({
    schema: "blocky.course-draft/v1",
    question: parsed.question,
    claims,
  } satisfies CourseDraft);
}

export function parseCourseDraft(value: string): CourseDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<CourseDraft>;
  if (candidate.schema !== "blocky.course-draft/v1" ||
    typeof candidate.question !== "string" ||
    !Array.isArray(candidate.claims)) return null;
  if (candidate.claims.length === 0 || candidate.claims.length > 16) return null;
  const valid = candidate.claims.every((rawClaim) => {
    if (!rawClaim || typeof rawClaim !== "object") return false;
    const claim = rawClaim as Partial<CourseDraftClaim>;
    const stringOrNull = (field: unknown) => typeof field === "string" || field === null;
    const validCitation = claim.citation === null || (
      typeof claim.citation === "object" &&
      typeof claim.citation.evidenceId === "string" &&
      typeof claim.citation.title === "string" &&
      typeof claim.citation.section === "string"
    );
    return (claim.kind === "evidence" || claim.kind === "unverified") &&
      typeof claim.text === "string" &&
      stringOrNull(claim.subject) &&
      stringOrNull(claim.highlightLabel) &&
      stringOrNull(claim.highlight) &&
      validCitation;
  });
  return valid ? candidate as CourseDraft : null;
}

export function createCourseModelResult(
  context: RankedCourseEvidenceContext,
  draft: CourseDraft,
): CourseModelResult {
  return Object.freeze({
    schema: "blocky.course-model-result/v1",
    context,
    draft,
  });
}

export function isCourseModelResult(value: unknown): value is CourseModelResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CourseModelResult>;
  return candidate.schema === "blocky.course-model-result/v1" &&
    isRankedCourseEvidenceContext(candidate.context) &&
    !!candidate.draft && candidate.draft.schema === "blocky.course-draft/v1";
}

export function guardCourseModelResult(result: CourseModelResult): GuardedCourseAnswer {
  const evidenceById = new Map(result.context.evidence.map((chunk) => [chunk.id, chunk]));
  const claims = result.draft.claims.map((claim): GuardedCourseClaim => {
    const evidence = claim.citation
      ? evidenceById.get(claim.citation.evidenceId)
      : undefined;
    if (evidence && claim.citation?.title === evidence.title &&
      claim.citation.section === evidence.section) {
      return Object.freeze({
        kind: "evidence",
        text: evidence.text,
        subject: evidence.heading,
        highlightLabel: evidence.highlightLabel,
        highlight: evidence.highlight,
        citation: {
          evidenceId: evidence.id,
          title: evidence.title,
          section: evidence.section,
        },
        supported: true,
      });
    }
    const requestedSubject = claim.subject &&
      result.context.requestedDetails.includes(claim.subject)
      ? claim.subject
      : normalizeUnknownSubject(result.context.question);
    return Object.freeze({
      kind: "unverified",
      text: `关于“${requestedSubject}”，课程资料没有说明，待核实。`,
      subject: requestedSubject,
      highlightLabel: null,
      highlight: null,
      citation: null,
      supported: false,
    });
  });
  return Object.freeze({
    schema: "blocky.course-guarded-answer/v1",
    question: result.context.question,
    claims: Object.freeze(claims),
  });
}

export function isGuardedCourseAnswer(value: unknown): value is GuardedCourseAnswer {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GuardedCourseAnswer>;
  return candidate.schema === "blocky.course-guarded-answer/v1" &&
    typeof candidate.question === "string" &&
    Array.isArray(candidate.claims);
}

export function attachCourseCitations(answer: GuardedCourseAnswer): CitedCourseAnswer {
  return Object.freeze({
    schema: "blocky.course-cited-answer/v1",
    question: answer.question,
    claims: Object.freeze(answer.claims.map((claim) => Object.freeze({
      ...claim,
      citationLabel: claim.citation
        ? `[${claim.citation.title}${claim.citation.section}]`
        : null,
    }))),
  });
}

export function isCitedCourseAnswer(value: unknown): value is CitedCourseAnswer {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CitedCourseAnswer>;
  return candidate.schema === "blocky.course-cited-answer/v1" &&
    typeof candidate.question === "string" &&
    Array.isArray(candidate.claims);
}

export function formatCourseMarkdown(answer: CitedCourseAnswer): string {
  const lines = ["## 课程资料综合回答"];
  const supported = answer.claims.filter((claim) => claim.supported);
  const unverified = answer.claims.filter((claim) => !claim.supported);

  supported.forEach((claim, index) => {
    lines.push(
      "",
      `### ${index + 1}. ${claim.subject ?? "课程结论"}`,
      "",
      claim.text,
    );
    if (claim.highlightLabel && claim.highlight) {
      lines.push("", `- **${claim.highlightLabel}：** ${claim.highlight}`);
    }
    if (claim.citationLabel) {
      lines.push(`- **课程依据：** ${claim.citationLabel}`);
    }
  });

  if (unverified.length > 0) {
    lines.push("", `### ${supported.length + 1}. 资料完整性检查`, "");
    for (const claim of unverified) {
      lines.push(`- **${claim.subject ?? "未支持结论"}：** 待核实`);
    }
    lines.push("- **原因：** 当前课程资料没有提供可支持的具体答案。");
  }

  lines.push("", "> 回答范围：仅基于当前课程资料库。");
  return lines.join("\n");
}
