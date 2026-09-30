import {
  assertRetrySafe,
  boundedField,
  condition,
  controlBody,
  controlTypes,
  validateControlNode,
  type IrNode,
  type Json,
} from "@blocky/language-schema";
import { RunBudget, utf8, wait } from "./budget";
export { assertRetrySafe } from "@blocky/language-schema";
export type ControlState = {
  value: Json;
  question: string;
  memory: Json;
  budget: RunBudget;
};
const recoverable = (error: unknown): error is Error =>
  error instanceof Error &&
  /^BLK-[A-Z0-9-]{3,64}$/.test(error.message) &&
  !/^(BLK-RUN-|BLK-PERM-|BLK-APPROVAL-)/.test(error.message) &&
  !/(UNCERTAIN|CANCELLED|CHANNEL|REPLAY)/.test(error.message);
function select(state: ControlState, source: Json): Json {
  return source === "input"
    ? state.question
    : source === "memory"
      ? state.memory
      : state.value;
}
/** Structured loops share the parent budget and never create another runtime. */
export async function executeControlFlow(
  node: IrNode,
  state: ControlState,
  execute: (node: IrNode) => Promise<void>,
  readOnlyTool?: (id: string) => boolean,
): Promise<boolean> {
  if (!controlTypes.includes(node.blockType as (typeof controlTypes)[number]))
    return false;
  validateControlNode(node);
  const f = node.fields,
    { budget } = state;
  const run = async (body: IrNode) => {
    budget.check();
    budget.step();
    await execute(body);
    budget.check();
  };
  switch (node.blockType) {
    case "core.flow.repeat":
      for (
        let index = 0, count = boundedField(f.COUNT, 0, 100);
        index < count;
        index++
      )
        await run(controlBody(node)!);
      break;
    case "core.flow.foreach": {
      const input = select(state, f.SOURCE),
        limit = boundedField(f.MAX_ITEMS, 1, 100);
      if (!Array.isArray(input)) throw Error("BLK-FLOW-CONFIG");
      if (input.length > limit) throw Error("BLK-FLOW-LIMIT");
      const items = structuredClone(input),
        results: Json[] = [];
      for (const item of items) {
        state.value = item;
        await run(controlBody(node)!);
        results.push(structuredClone(state.value));
        if (utf8(JSON.stringify(results)) > 32768)
          throw Error("BLK-FLOW-LIMIT");
      }
      state.value = results;
      break;
    }
    case "core.flow.while": {
      let count = 0;
      const limit = boundedField(f.MAX_ITERATIONS, 1, 100);
      while (condition(select(state, f.SOURCE), f.OP, f.VALUE)) {
        if (count++ >= limit) throw Error("BLK-FLOW-LIMIT");
        await run(controlBody(node)!);
      }
      break;
    }
    case "core.flow.try":
      try {
        await run(controlBody(node, "TRY")!);
      } catch (error) {
        budget.check();
        if (!recoverable(error)) throw error;
        state.value = { error: { code: error.message } };
        await run(controlBody(node, "CATCH")!);
      }
      break;
    case "core.flow.retry": {
      const body = controlBody(node)!,
        attempts = boundedField(f.ATTEMPTS, 1, 3),
        before = structuredClone(state.value);
      assertRetrySafe(body, readOnlyTool);
      for (let attempt = 1; attempt <= attempts; attempt++) {
        state.value = structuredClone(before);
        try {
          await run(body);
          break;
        } catch (error) {
          budget.check();
          if (attempt === attempts || !recoverable(error)) throw error;
          await wait(boundedField(f.WAIT_MS, 0, 3000), budget.signal);
        }
      }
      break;
    }
  }
  budget.check();
  return true;
}
