import { expect, it } from "vitest";
import { runPiLoop } from "../src/pi-loop";
import { RunBudget } from "../src/budget";
import { createAgentExample } from "../../test-fixtures/src/scenarios";
import type { Generation, GenerationRequest } from "../src/agent-context";
import type { ToolLoopContext } from "../src/tool-loop";
import { createStartingBlueprint } from "../../block-catalog/src/starting-blueprints";
import type { Json } from "@blocky/language-schema";

const response = (text: string, toolCalls: Generation["toolCalls"] = []): Generation => ({
  provider: "unit-fixture", transport: "local", model: "unit-fixture", requestId: "unit-result",
  text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", usage: null,
});
function setup(generate: ToolLoopContext["generate"], invoke: ToolLoopContext["invoke"]) {
  const project = createAgentExample("pi-test"), budget = new RunBudget();
  const context: ToolLoopContext = { project, model: project.resources["agent-model"], budget, capabilities: ["text.analyze"],
    requestId: "pi-test", question: "count", role: "reader", instruction: "return actual receipts", memory: null, value: null,
    citations: [], requireEvidence: false, resourceIds: ["text-tool"], maxTurns: 3, outputPerTurn: 128, generate, invoke,
    onGeneration() {}, onEvent() {},
  };
  return { context, budget };
}
it("uses official Pi dispatch and feeds actual tool output into the next model turn", async () => {
  const requests: GenerationRequest[] = [];
  let calls = 0;
  const { context, budget } = setup(async (request) => {
    requests.push(request);
    return requests.length === 1 ? response("", [{ id: "call_Upper_42", name: "tool_1", arguments: { input: "alpha beta" } }]) : response("2 words");
  }, async (_tool, value, requestId) => { calls++; expect(value).toBe("alpha beta"); expect(requestId).toMatch(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/); return { words: 2, characters: 10, lines: 1 }; });
  try {
    expect(await runPiLoop(context)).toBe("2 words");
    expect(calls).toBe(1);
    expect(requests[1].messages.at(-1)).toMatchObject({ role: "tool", toolCallId: "call_Upper_42" });
    expect(JSON.parse(requests[1].messages.at(-1)!.content).words).toBe(2);
    expect(requests[0].messages[0].content).toContain("reader");
    expect(budget.calls).toBe(3);
  } finally { budget.dispose(); }
});
it("rejects a malformed batch before any side effect", async () => {
  let calls = 0;
  const { context, budget } = setup(async () => response("", [
    { id: "good", name: "tool_1", arguments: { input: "one" } },
    { id: "bad", name: "unknown", arguments: { input: "two" } },
  ]), async () => { calls++; return null; });
  try { await expect(runPiLoop(context)).rejects.toThrow("BLK-TOOL-PROPOSAL"); expect(calls).toBe(0); }
  finally { budget.dispose(); }
});
it("feeds a rejected input batch back through official Pi before executing any corrected tool", async () => {
  const requests: GenerationRequest[] = [];
  const invoked: Json[] = [];
  const { context, budget } = setup(async (request) => {
    requests.push(request);
    if (requests.length === 1) return response("", [
      { id: "valid-unexecuted", name: "tool_1", arguments: { input: "original" } },
      { id: "bad-input", name: "tool_1", arguments: { input: { secret: "private argument sentinel" } } },
    ]);
    if (requests.length === 2) {
      expect(invoked).toEqual([]);
      expect(request.messages.at(-1)?.content).toContain("BLK-OUTPUT-001");
      expect(JSON.stringify(request.messages)).not.toContain("private argument sentinel");
      expect(request.messages.flatMap((m) => m.toolCalls ?? [])).toEqual([]);
      return response("", [{ id: "corrected", name: "tool_1", arguments: { input: "correct" } }]);
    }
    return response("corrected tool returned actual receipt");
  }, async (_tool, value) => { invoked.push(value); return { words: 1, characters: 7, lines: 1 }; });
  try {
    expect(await runPiLoop(context)).toBe("corrected tool returned actual receipt");
    expect(invoked).toEqual(["correct"]);
    expect(requests).toHaveLength(3);
    expect(budget.calls).toBe(4);
  } finally { budget.dispose(); }
});
it("keeps parameter correction inside the original model and turn budgets", async () => {
  let calls = 0, invoked = 0;
  const { context, budget } = setup(async () => {
    calls++;
    return response("", [{ id: `invalid-${calls}`, name: "tool_1", arguments: { input: 42 } }]);
  }, async () => { invoked++; return null; });
  context.maxTurns = 3;
  try {
    await expect(runPiLoop(context)).rejects.toThrow("BLK-TOOL-LOOP-LIMIT");
    expect(calls).toBe(3);
    expect(invoked).toBe(0);
    expect(budget.calls).toBe(3);
  } finally { budget.dispose(); }
});
it("does not reset the call budget for a parameter correction turn", async () => {
  let requests = 0, invoked = 0;
  const { context, budget } = setup(async () => {
    requests++;
    return response("", [{ id: "invalid", name: "tool_1", arguments: { input: 42 } }]);
  }, async () => { invoked++; return null; });
  budget.maxCalls = 1;
  try {
    await expect(runPiLoop(context)).rejects.toThrow("BLK-RUN-004");
    expect(requests).toBe(1);
    expect(invoked).toBe(0);
    expect(budget.maxCalls).toBe(1);
    expect(budget.usedOutput).toBe(128);
  } finally { budget.dispose(); }
});
it("rejects duplicate operations within one proposed batch before any side effect",async()=>{
  let calls=0;
  const {context,budget}=setup(async()=>response("",[{id:"one",name:"tool_1",arguments:{input:"same"}},{id:"two",name:"tool_1",arguments:{input:"same"}}]),async()=>{calls++;return null;});
  try{await expect(runPiLoop(context)).rejects.toThrow("BLK-TOOL-DUPLICATE");expect(calls).toBe(0);}finally{budget.dispose();}
});
it("allows actual check feedback to drive a write and recheck in subsequent Pi turns",async()=>{
  let turn=0;const performed:string[]=[];
  const {context,budget}=setup(async()=>{
    turn++;
    if(turn===1||turn===3)return response("",[{id:`check-${turn}`,name:"tool_1",arguments:{input:{path:"sample.js",kind:"javascript"}}}]);
    if(turn===2)return response("",[{id:"fix-two",name:"tool_2",arguments:{input:{path:"sample.js",text:"const value = 1;",expectedDigest:"0".repeat(64)}}}]);
    return response("syntax corrected and verified");
  },async(tool):Promise<Json>=>{performed.push(String(tool.definition.operation));return tool.definition.operation==="check"?{ok:performed.length>1,exitCode:performed.length>1?0:1}:{change:{changeId:"change-fix"}};});
  context.project=createStartingBlueprint("coding-assistant");context.resourceIds=["workspace-check","workspace-write"];context.capabilities=["workspace.check","workspace.write"];context.maxTurns=4;
  try{expect(await runPiLoop(context)).toBe("syntax corrected and verified");expect(performed).toEqual(["check","write","check"]);}finally{budget.dispose();}
});
it("allows a Pi core without tools and accepts bounded prior conversation", async () => {
  const { context, budget } = setup(async (request) => {
    expect(request.messages.some((m) => m.content === "previous response")).toBe(true);
    expect(request.tools).toEqual([]);
    expect(request.toolChoice).toBe("none");
    return response("answer");
  }, async () => { throw Error("unexpected tool"); });
  context.resourceIds = [];
  try { expect(await runPiLoop(context, [{ role: "assistant", content: "previous response" }])).toBe("answer"); }
  finally { budget.dispose(); }
});
it("uses official Pi follow-up feedback to repair undeclared citations without accepting the invalid answer",async()=>{
  const requests:GenerationRequest[]=[];
  const {context,budget}=setup(async(request)=>{requests.push(request);return requests.length===1?response("Fixed [source:sample.js]"):response("sample.js syntax check passed");},async()=>null);
  context.resourceIds=[];
  try{expect(await runPiLoop(context)).toBe("sample.js syntax check passed");expect(requests).toHaveLength(2);expect(requests[1].messages.at(-1)?.content).toContain("BLK-GUARD-001");expect(requests[0].messages[0].content).toContain("没有知识来源ID");}finally{budget.dispose();}
});
it("keeps the citation guard and turn budget when Pi cannot repair its final answer",async()=>{
  let calls=0;const {context,budget}=setup(async()=>{calls++;return response("Invalid [source:unknown]");},async()=>null);context.resourceIds=[];context.maxTurns=2;
  try{await expect(runPiLoop(context)).rejects.toThrow("BLK-GUARD-001");expect(calls).toBe(2);}finally{budget.dispose();}
});
it("settles cancellation even when the model port is uncooperative", async () => {
  const { context, budget } = setup(async () => new Promise(() => {}), async () => null);
  const pending = runPiLoop(context);
  budget.controller.abort(Error("BLK-RUN-005"));
  try { await expect(pending).rejects.toThrow("BLK-RUN-005"); }
  finally { budget.dispose(); }
});
it("enforces the last-turn limit before executing tool proposals", async () => {
  let calls = 0;
  const { context, budget } = setup(async () => response("", [{ id: "one", name: "tool_1", arguments: { input: "x" } }]), async () => { calls++; return null; });
  context.maxTurns = 1;
  try { await expect(runPiLoop(context)).rejects.toThrow("BLK-TOOL-LOOP-LIMIT"); expect(calls).toBe(0); }
  finally { budget.dispose(); }
});

it("preserves provider reasoning through the official Pi tool round trip", async () => {
  const requests: GenerationRequest[]=[];
  const {context,budget}=setup(async request=>{
    requests.push(structuredClone(request));
    return requests.length===1 ? {...response("",[{id:"think_call",name:"tool_1",arguments:{input:"two words"}}]),reasoningContent:"Actual provider reasoning"} : response("2 words");
  }, async()=>({words:2,characters:9,lines:1}));
  context.reasoningEffort="max";
  try {
    expect(await runPiLoop(context)).toBe("2 words");
    expect(requests.every(r=>r.reasoningEffort==="max")).toBe(true);
    expect(requests[1].messages.find(m=>m.role==="assistant")?.reasoningContent).toBe("Actual provider reasoning");
  } finally {budget.dispose();}
});
