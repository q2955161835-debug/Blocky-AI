import type { IrNode, WorkspaceBlock } from "@blocky/language-schema";
import {
  rpaPlanSchema,
  rpaBrowserStartSchema,
  type RpaPlan,
  type RpaStep,
  type RpaBrowserStart,
} from "./index";

export const rpaSessionTypes = [
  "core.computer.attach",
  "core.browser.navigate",
] as const;
export const rpaStepTypes = [
  "core.computer.find",
  "core.computer.read",
  "core.computer.act",
  "core.computer.wait",
  "core.computer.capture",
  "core.browser.interact",
  "core.browser.extract",
] as const;
export const isRpaSession = (type: string) =>
  (rpaSessionTypes as readonly string[]).includes(type);
export const isRpaStep = (type: string) =>
  (rpaStepTypes as readonly string[]).includes(type);
export type RpaInputSource = "manual" | "input" | "result";
export type RpaModulePlan = {
  plan: RpaPlan;
  browser?: RpaBrowserStart;
  inputSources: Record<string, RpaInputSource>;
};

/** An attached session is a reviewed, finite step sequence. Runtime values never enter its plan. */
export function compileRpaSession(
  node: IrNode,
  projectId: string,
): RpaModulePlan {
  if (!isRpaSession(node.blockType)) throw Error("BLK-RPA-SCOPE-001");
  const kind =
    node.blockType === "core.browser.navigate" ? "browser" : "windows";
  const browser =
    kind === "browser"
      ? rpaBrowserStartSchema.parse({ projectId, url: node.fields.URL })
      : undefined;
  const steps: RpaStep[] = [],
    inputSources: Record<string, RpaInputSource> = {};
  let current = node.inputs.STEPS;
  if (
    Array.isArray(current) ||
    !current ||
    Object.keys(node.inputs).some((key) => key !== "STEPS")
  )
    throw Error("BLK-RPA-SCOPE-001");
  const seen = new Set<string>();
  while (current) {
    if (
      steps.length >= 100 ||
      seen.has(current.nodeId) ||
      !isRpaStep(current.blockType) ||
      Object.keys(current.inputs).length
    )
      throw Error("BLK-RPA-SCOPE-001");
    seen.add(current.nodeId);
    if (current.blockType.startsWith("core.browser.") !== (kind === "browser"))
      throw Error("BLK-RPA-LOCATOR-002");
    const fields = current.fields;
    const fixedActions: Record<string, RpaStep["action"] | undefined> = {
      "core.computer.find": "find",
      "core.computer.read": "read",
      "core.computer.wait": "wait",
      "core.computer.capture": "screenshot",
      "core.browser.extract": "read",
    };
    const action = fixedActions[current.blockType] ?? fields.ACTION;
    if (
      !fields.LOCATOR ||
      typeof fields.LOCATOR !== "object" ||
      Array.isArray(fields.LOCATOR) ||
      JSON.stringify(fields.LOCATOR).length > 4096 ||
      typeof fields.TIMEOUT_MS !== "string" ||
      !/^\d+$/.test(fields.TIMEOUT_MS)
    )
      throw Error("BLK-RPA-PLAN-001");
    const locator = fields.LOCATOR;
    if (fields.INPUT_KIND !== undefined && !["ordinary", "sensitive"].includes(String(fields.INPUT_KIND)))
      throw Error("BLK-RPA-INPUT-001");
    const sensitive = fields.INPUT_KIND === "sensitive";
    if (sensitive && (action !== "fill" || fields.SOURCE !== "manual"))
      throw Error("BLK-RPA-SENSITIVE-001");
    if (action === "fill") {
      if (!["manual", "input", "result"].includes(String(fields.SOURCE)))
        throw Error("BLK-RPA-INPUT-001");
      inputSources[current.nodeId] = fields.SOURCE as RpaInputSource;
    }
    steps.push({
      stepId: current.nodeId,
      action,
      locator,
      timeoutMs: Number(fields.TIMEOUT_MS),
      ...(action === "fill" ? { value: { kind: "manual-input", ...(sensitive ? { sensitive: true } : {}) } } : {}),
      ...(action === "fill" || action === "click"
        ? { effectKey: current.nodeId }
        : {}),
    } as RpaStep);
    current = current.next ?? null;
  }
  const parsed = rpaPlanSchema.safeParse({
    schemaVersion: "blocky.rpa/v1",
    planId: node.nodeId,
    target: {
      kind,
      identity: browser ? new URL(browser.url).origin : node.fields.TARGET,
    },
    steps,
  });
  if (!parsed.success) throw Error("BLK-RPA-PLAN-001");
  return { plan: parsed.data, ...(browser ? { browser } : {}), inputSources };
}

/** A proposal for normal Workspace blocks; caller must use the existing semantic patch review. */
export function planToRpaBlocks(
  input: unknown,
  browserUrl?: string,
): WorkspaceBlock {
  const plan = rpaPlanSchema.parse(input);
  if (plan.target.kind === "browser") {
    const start = rpaBrowserStartSchema.parse({
      projectId: "draft",
      url: browserUrl,
    });
    if (new URL(start.url).origin !== plan.target.identity)
      throw Error("BLK-RPA-TARGET-001");
  }
  const id = () => `rpa-${crypto.randomUUID()}`;
  const blocks: WorkspaceBlock[] = plan.steps.map((step) => ({
    id: id(),
    type:
      plan.target.kind === "browser"
        ? step.action === "read"
          ? "core.browser.extract"
          : "core.browser.interact"
        : {
            find: "core.computer.find",
            read: "core.computer.read",
            wait: "core.computer.wait",
            screenshot: "core.computer.capture",
            click: "core.computer.act",
            fill: "core.computer.act",
          }[step.action],
    fields: {
      LOCATOR: structuredClone(step.locator),
      TIMEOUT_MS: String(step.timeoutMs),
      ...((plan.target.kind === "browser" && step.action !== "read") ||
      ["click", "fill"].includes(step.action)
        ? { ACTION: step.action, SOURCE: "manual", INPUT_KIND: step.value?.sensitive ? "sensitive" : "ordinary" }
        : {}),
    },
  }));
  blocks.forEach((block, i) => {
    if (blocks[i + 1]) block.next = { block: blocks[i + 1] };
  });
  return {
    type: "core.interaction.chat_entry",
    id: id(),
    x: 80,
    y: 80,
    fields: { NAME: "有人值守自动化" },
    inputs: {
      CAPABILITIES: {
        block: { type: "core.interaction.accept_text", id: id() },
      },
      HANDLER: {
        block: {
          id: id(),
          type:
            plan.target.kind === "browser"
              ? "core.browser.navigate"
              : "core.computer.attach",
          fields:
            plan.target.kind === "browser"
              ? { URL: browserUrl! }
              : { TARGET: plan.target.identity },
          inputs: { STEPS: { block: blocks[0] } },
        },
      },
    },
  };
}

export function rpaNodePermissions(
  type: string,
  fields: IrNode["fields"],
): string[] {
  if (isRpaSession(type))
    return [type === "core.browser.navigate" ? "rpa.browser" : "rpa.windows"];
  if (!isRpaStep(type)) return [];
  const result = ["rpa.read"];
  if (["click", "fill"].includes(String(fields.ACTION)))
    result.push("rpa.write");
  if (fields.ACTION === "fill") result.push("rpa.input");
  if (fields.ACTION === "fill" && fields.INPUT_KIND === "sensitive") result.push("rpa.sensitive-input");
  if (type === "core.computer.capture" || fields.ACTION === "screenshot")
    result.push("rpa.capture");
  if (
    fields.LOCATOR &&
    typeof fields.LOCATOR === "object" &&
    !Array.isArray(fields.LOCATOR) &&
    fields.LOCATOR.kind === "coordinate"
  )
    result.push("rpa.coordinate");
  return result;
}
