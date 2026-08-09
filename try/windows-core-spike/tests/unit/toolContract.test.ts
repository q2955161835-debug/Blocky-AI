import { describe, expect, it } from "vitest";
import type { BlockyProgram, IrNode } from "../../src/core/ir";
import {
  compileToolRegistry,
  resolveToolUsages,
  validateToolArgs,
} from "../../src/core/toolContract";

function node(
  id: string,
  type: string,
  options: Omit<IrNode, "id" | "type"> = {},
): IrNode {
  return { id, type, ...options };
}

function toolProgram(options: {
  toolId?: string;
  name?: string;
  parameterName?: string;
  parameterType?: string;
  required?: boolean;
  defaultValue?: unknown;
  resultSchema?: unknown;
  callArgs?: unknown;
} = {}): BlockyProgram {
  const parameterFields: Record<string, string | number | boolean | null> = {
    NAME: options.parameterName ?? "city",
    TYPE: options.parameterType ?? "string",
    REQUIRED: options.required ?? true,
  };
  if (options.defaultValue !== undefined) parameterFields.DEFAULT = options.defaultValue as string | number | boolean | null;

  const toolId = options.toolId ?? "tool-weather";
  const resultSchema = options.resultSchema ?? { temperature: { type: "number" } };
  const callArgs = options.callArgs ?? { city: "上海" };
  const reference = (id: string) => node(id, "core.tool.reference", { fields: { TOOL_ID: toolId } });

  return {
    schemaVersion: "blocky.ir/v0-spike",
    roots: [
      node("agent-1", "core.agent.define", {
        inputs: {
          MEMBERS: node("attach-1", "core.agent.add_tool", {
            inputs: { TOOL: reference("agent-reference") },
          }),
        },
      }),
      node("tool-1", "core.tool.define", {
        fields: { TOOL_ID: toolId, NAME: options.name ?? "查询天气", DESCRIPTION: "查询指定城市天气" },
        inputs: {
          CONTRACT: node("parameter-1", "core.tool.parameter", {
            fields: parameterFields,
            next: node("result-1", "core.tool.result_schema", { fields: { SCHEMA: resultSchema as never } }),
          }),
        },
      }),
      node("call-1", "core.tool.call", {
        fields: { ARGS: callArgs as never },
        inputs: { TOOL: reference("call-reference") },
      }),
    ],
  };
}

describe("Tool 契约", () => {
  it("通过稳定 ID 让附加和显式调用共享同一个只读契约对象", () => {
    const program = toolProgram();
    const registry = compileToolRegistry(program);
    const usages = resolveToolUsages(program, registry.contracts);

    expect(registry.diagnostics).toEqual([]);
    expect(registry.contracts.get("tool-weather")?.name).toBe("查询天气");
    expect(usages.agentAttachments[0].contract).toBe(usages.explicitCalls[0].contract);
    expect(usages.explicitCalls[0].call).toEqual({
      callBlockId: "call-1",
      toolId: "tool-weather",
      args: { city: "上海" },
    });
    expect(Object.isFrozen(usages.explicitCalls[0].contract)).toBe(true);
    expect(Object.isFrozen(usages.explicitCalls[0].contract.inputSchema)).toBe(true);
  });

  it("在编译期报告重复、缺失、重复参数、无效参数、无效默认值和非对象结果架构", () => {
    const invalid = toolProgram();
    const parameter = invalid.roots[1].inputs?.CONTRACT;
    if (!parameter) throw new Error("test fixture missing parameter");
    parameter.next = node("parameter-duplicate", "core.tool.parameter", {
      fields: { NAME: "city", TYPE: "string" },
      next: node("parameter-invalid", "core.tool.parameter", {
        fields: { NAME: "when", TYPE: "array", DEFAULT: [] },
        next: node("result-invalid", "core.tool.result_schema", { fields: { SCHEMA: "not-an-object" } }),
      }),
    });
    const duplicate = toolProgram();
    duplicate.roots.push(node("tool-duplicate", "core.tool.define", { fields: { TOOL_ID: "tool-weather" } }));
    const usageProgram = toolProgram({ toolId: "tool-missing" });

    expect(compileToolRegistry(invalid).diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "TOOL_PARAMETER_DUPLICATE",
      "TOOL_PARAMETER_INVALID",
      "TOOL_PARAMETER_INVALID_DEFAULT",
      "TOOL_RESULT_SCHEMA_NOT_OBJECT",
    ]));
    expect(compileToolRegistry(duplicate).diagnostics.map((item) => item.code)).toContain("TOOL_DUPLICATE_ID");
    expect(resolveToolUsages(usageProgram, new Map()).diagnostics).toContainEqual(expect.objectContaining({
      code: "TOOL_REFERENCE_MISSING",
      message: expect.stringMatching(/[\u4e00-\u9fff]/),
    }));
  });

  it("验证参数时保留未知参数并报告意外参数和缺少必填参数", () => {
    const contract = compileToolRegistry(toolProgram()).contracts.get("tool-weather");
    if (!contract) throw new Error("test fixture missing contract");

    expect(validateToolArgs(contract, { unknown: true }).map((item) => item.code)).toEqual([
      "TOOL_CALL_UNEXPECTED_ARGUMENT",
      "TOOL_CALL_MISSING_REQUIRED_ARGUMENT",
    ]);
  });

  it("只接受明确的对象结果 schema，并拒绝带缺失或冲突保留字段的形式", () => {
    const primitive = toolProgram({ resultSchema: { type: "string" } });
    const incomplete = toolProgram({ resultSchema: { properties: {} } });

    expect(compileToolRegistry(primitive).contracts.has("tool-weather")).toBe(false);
    expect(compileToolRegistry(primitive).diagnostics).toContainEqual(expect.objectContaining({
      code: "TOOL_RESULT_SCHEMA_NOT_OBJECT",
      message: expect.stringMatching(/[\u4e00-\u9fff]/),
    }));
    expect(compileToolRegistry(incomplete).contracts.has("tool-weather")).toBe(false);
    expect(compileToolRegistry(incomplete).diagnostics).toContainEqual(expect.objectContaining({
      code: "TOOL_RESULT_SCHEMA_INVALID",
      message: expect.stringMatching(/[\u4e00-\u9fff]/),
    }));
  });

  it("拒绝非 plain JSON 对象 ARGS，且不泄漏显式调用", () => {
    const invalidArgs = ["text", [], new Date()] as const;

    for (const args of invalidArgs) {
      const program = toolProgram({ callArgs: args });
      const registry = compileToolRegistry(program);
      const usages = resolveToolUsages(program, registry.contracts);

      expect(usages.explicitCalls).toEqual([]);
      expect(usages.diagnostics).toContainEqual(expect.objectContaining({
        code: "TOOL_CALL_INVALID_ARGUMENTS",
        message: expect.stringMatching(/[\u4e00-\u9fff]/),
      }));
    }
  });

  it("只从 ARGS 读取参数，并拒绝孤立别名和冲突双字段", () => {
    const aliasOnly = toolProgram();
    const aliasFields = aliasOnly.roots[2].fields as Record<string, unknown>;
    delete aliasFields.ARGS;
    aliasFields.ARGUMENTS = { city: "上海" };
    const conflict = toolProgram();
    (conflict.roots[2].fields as Record<string, unknown>).ARGUMENTS = { city: "北京" };

    const aliasUsages = resolveToolUsages(aliasOnly, compileToolRegistry(aliasOnly).contracts);
    const conflictUsages = resolveToolUsages(conflict, compileToolRegistry(conflict).contracts);

    expect(aliasUsages.explicitCalls).toEqual([]);
    expect(aliasUsages.diagnostics.map((item) => item.code)).toContain("TOOL_CALL_ARGUMENTS_ALIAS_UNSUPPORTED");
    expect(conflictUsages.explicitCalls).toEqual([]);
    expect(conflictUsages.diagnostics.map((item) => item.code)).toContain("TOOL_CALL_ARGUMENT_FIELDS_CONFLICT");
  });

  it("工具定义变化后，两种用法都解析到新契约，且不安全调用保留参数", () => {
    const first = toolProgram();
    const firstRegistry = compileToolRegistry(first);
    expect(resolveToolUsages(first, firstRegistry.contracts).diagnostics).toEqual([]);

    const updated = toolProgram({ parameterName: "cityName" });
    const updatedRegistry = compileToolRegistry(updated);
    const updatedUsages = resolveToolUsages(updated, updatedRegistry.contracts);

    expect(updatedUsages.agentAttachments[0].contract.inputSchema.required).toEqual(["cityName"]);
    expect(updatedUsages.explicitCalls[0].contract).toBe(updatedUsages.agentAttachments[0].contract);
    expect(updatedUsages.explicitCalls[0].call.args).toEqual({ city: "上海" });
    expect(updatedUsages.diagnostics.map((item) => item.code)).toContain(
      "TOOL_CALL_MISSING_REQUIRED_ARGUMENT",
    );
  });
});
