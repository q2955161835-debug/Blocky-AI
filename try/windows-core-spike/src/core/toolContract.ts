import type { Diagnostic } from "./diagnostics";
import type { BlockyProgram, IrNode } from "./ir";
import { canonicalizeJson, type JsonValue } from "./json";

type ParameterType = "string" | "number" | "boolean";

export interface JsonSchema {
  type: "object";
  properties: Record<string, { type: ParameterType }>;
  required: string[];
  additionalProperties: false;
}

/** The sole Core representation of a Tool, independent of its display name. */
export interface ToolContract {
  id: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permissions: string[];
  requiresApproval: boolean;
  implementation: { kind: "mock"; result: JsonValue };
}

/** The sole Core representation of an explicit Tool invocation. */
export interface ToolCall {
  callBlockId: string;
  toolId: string;
  args: Record<string, JsonValue>;
}

export interface ToolRegistryResult {
  contracts: Map<string, Readonly<ToolContract>>;
  diagnostics: Diagnostic[];
}

export interface ToolUsageResult {
  agentAttachments: Array<{
    agentId: string;
    referenceBlockId: string;
    contract: Readonly<ToolContract>;
  }>;
  explicitCalls: Array<{
    call: ToolCall;
    contract: Readonly<ToolContract>;
  }>;
  diagnostics: Diagnostic[];
}

function error(code: string, message: string, blockId?: string): Diagnostic {
  return { code, message, severity: "error", ...(blockId ? { blockId } : {}) };
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainJsonRecord(value: unknown): value is Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stringField(node: IrNode, name: string): string | undefined {
  const value = node.fields?.[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function parameterType(value: JsonValue | undefined): ParameterType | undefined {
  return value === "string" || value === "number" || value === "boolean" ? value : undefined;
}

function isRequired(value: JsonValue | undefined): boolean {
  return value === true || value === "true" || value === "TRUE";
}

function hasField(node: IrNode, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(node.fields ?? {}, name);
}

function hasOwn(value: object, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, name);
}

function valueMatchesType(value: JsonValue, type: ParameterType): boolean {
  return typeof value === type;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function walk(node: IrNode, visit: (current: IrNode) => void): void {
  visit(node);
  for (const child of Object.values(node.inputs ?? {})) walk(child, visit);
  if (node.next) walk(node.next, visit);
}

function allNodes(program: BlockyProgram): IrNode[] {
  const nodes: IrNode[] = [];
  for (const root of program.roots) walk(root, (node) => nodes.push(node));
  return nodes;
}

function emptySchema(): JsonSchema {
  return { type: "object", properties: {}, required: [], additionalProperties: false };
}

function compileOutputSchema(node: IrNode, diagnostics: Diagnostic[]): JsonSchema | undefined {
  const raw = node.fields?.SCHEMA;
  if (raw === undefined) return emptySchema();
  if (!isPlainJsonRecord(raw)) {
    diagnostics.push(error("TOOL_RESULT_SCHEMA_NOT_OBJECT", "工具结果架构必须是对象", node.id));
    return undefined;
  }

  const reservedKeys = ["type", "properties", "required", "additionalProperties"] as const;
  const hasReservedKey = reservedKeys.some((key) => hasOwn(raw, key));
  const schema = emptySchema();
  let propertiesRaw: Record<string, JsonValue>;
  let requiredRaw: JsonValue[];
  if (hasReservedKey) {
    if (!hasOwn(raw, "type")) {
      diagnostics.push(error("TOOL_RESULT_SCHEMA_INVALID", "工具结果对象架构缺少 type: object", node.id));
      return undefined;
    }
    if (raw.type !== "object") {
      diagnostics.push(error("TOOL_RESULT_SCHEMA_NOT_OBJECT", "工具结果架构 type 必须严格为 object", node.id));
      return undefined;
    }
    if (!isPlainJsonRecord(raw.properties) || !Array.isArray(raw.required) || raw.additionalProperties !== false) {
      diagnostics.push(error("TOOL_RESULT_SCHEMA_INVALID", "工具结果对象架构必须完整包含合法的 properties、required 和 additionalProperties: false", node.id));
      return undefined;
    }
    propertiesRaw = raw.properties;
    requiredRaw = raw.required;
  } else {
    // Compatibility: a record without JSON Schema reserved keys is a concise property map.
    propertiesRaw = raw;
    requiredRaw = [];
  }
  let valid = true;
  for (const [name, property] of Object.entries(propertiesRaw)) {
    const type = isRecord(property) ? parameterType(property.type) : undefined;
    if (!type) {
      diagnostics.push(error("TOOL_RESULT_SCHEMA_INVALID", `工具结果架构字段 ${name} 类型无效`, node.id));
      valid = false;
      continue;
    }
    schema.properties[name] = { type };
  }
  for (const required of requiredRaw) {
    if (typeof required !== "string" || !hasOwn(schema.properties, required) || schema.required.includes(required)) {
      diagnostics.push(error("TOOL_RESULT_SCHEMA_INVALID", "工具结果架构 required 必须引用已有字段", node.id));
      valid = false;
      continue;
    }
    schema.required.push(required);
  }
  return valid ? schema : undefined;
}

function compileDefinition(node: IrNode, diagnostics: Diagnostic[]): ToolContract | undefined {
  const id = stringField(node, "TOOL_ID");
  if (!id) {
    diagnostics.push(error("TOOL_ID_MISSING", "工具定义缺少稳定 TOOL_ID", node.id));
    return undefined;
  }

  const inputSchema = emptySchema();
  let outputSchema = emptySchema();
  let requiresApproval = false;
  let valid = true;
  const seenParameters = new Set<string>();
  let contractNode = node.inputs?.CONTRACT;
  while (contractNode) {
    if (contractNode.type === "core.tool.parameter") {
      const name = stringField(contractNode, "NAME");
      const type = parameterType(contractNode.fields?.TYPE ?? "string");
      if (!name || !type) {
        diagnostics.push(error("TOOL_PARAMETER_INVALID", "工具参数名称或类型无效，仅支持字符串、数字和布尔值", contractNode.id));
        if (hasField(contractNode, "DEFAULT")) {
          diagnostics.push(error("TOOL_PARAMETER_INVALID_DEFAULT", "工具参数的默认值与类型不匹配", contractNode.id));
        }
        valid = false;
      } else if (seenParameters.has(name)) {
        diagnostics.push(error("TOOL_PARAMETER_DUPLICATE", `工具参数 ${name} 重复`, contractNode.id));
        valid = false;
      } else {
        seenParameters.add(name);
        inputSchema.properties[name] = { type };
        if (isRequired(contractNode.fields?.REQUIRED)) inputSchema.required.push(name);
        if (hasField(contractNode, "DEFAULT")) {
          const defaultValue = contractNode.fields?.DEFAULT as JsonValue;
          if (!valueMatchesType(defaultValue, type)) {
            diagnostics.push(error("TOOL_PARAMETER_INVALID_DEFAULT", `工具参数 ${name} 的默认值与类型不匹配`, contractNode.id));
            valid = false;
          }
        }
      }
    } else if (contractNode.type === "core.tool.result_schema") {
      const compiled = compileOutputSchema(contractNode, diagnostics);
      if (!compiled) valid = false;
      else outputSchema = compiled;
    } else if (contractNode.type === "core.tool.require_approval") {
      requiresApproval = true;
    } else {
      diagnostics.push(error("TOOL_CONTRACT_INVALID", "工具合同包含不支持的积木", contractNode.id));
      valid = false;
    }
    contractNode = contractNode.next;
  }

  if (!valid) return undefined;
  return deepFreeze({
    id,
    name: stringField(node, "NAME") ?? id,
    description: stringField(node, "DESCRIPTION") ?? "",
    inputSchema,
    outputSchema,
    permissions: [],
    requiresApproval,
    implementation: { kind: "mock", result: {} },
  });
}

export function compileToolRegistry(program: BlockyProgram): ToolRegistryResult {
  const diagnostics: Diagnostic[] = [];
  const definitions = allNodes(program).filter((node) => node.type === "core.tool.define");
  const counts = new Map<string, number>();
  for (const definition of definitions) {
    const id = stringField(definition, "TOOL_ID");
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const duplicated = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
  for (const id of [...duplicated].sort((left, right) => left.localeCompare(right))) {
    diagnostics.push(error("TOOL_DUPLICATE_ID", `稳定工具 ID ${id} 重复`));
  }

  const contracts = new Map<string, Readonly<ToolContract>>();
  for (const definition of definitions) {
    const id = stringField(definition, "TOOL_ID");
    if (id && duplicated.has(id)) continue;
    const contract = compileDefinition(definition, diagnostics);
    if (contract) contracts.set(contract.id, contract);
  }
  return { contracts, diagnostics };
}

export function validateToolArgs(
  contract: ToolContract,
  args: Record<string, JsonValue>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [name, value] of Object.entries(args)) {
    const property = contract.inputSchema.properties[name];
    if (!property) {
      diagnostics.push(error("TOOL_CALL_UNEXPECTED_ARGUMENT", `工具 ${contract.id} 不接受参数 ${name}`));
    } else if (!valueMatchesType(value, property.type)) {
      diagnostics.push(error("TOOL_CALL_INVALID_ARGUMENT", `工具 ${contract.id} 的参数 ${name} 类型无效`));
    }
  }
  for (const name of contract.inputSchema.required) {
    if (!Object.prototype.hasOwnProperty.call(args, name)) {
      diagnostics.push(error("TOOL_CALL_MISSING_REQUIRED_ARGUMENT", `工具 ${contract.id} 缺少必填参数 ${name}`));
    }
  }
  return diagnostics;
}

function readReference(reference: IrNode | undefined, diagnostics: Diagnostic[]): { id: string; blockId: string } | undefined {
  if (!reference || reference.type !== "core.tool.reference") {
    diagnostics.push(error("TOOL_REFERENCE_MISSING", "工具使用缺少工具引用", reference?.id));
    return undefined;
  }
  const id = stringField(reference, "TOOL_ID");
  if (!id) {
    diagnostics.push(error("TOOL_REFERENCE_MISSING", "工具引用缺少稳定 TOOL_ID", reference.id));
    return undefined;
  }
  return { id, blockId: reference.id };
}

function resolveReference(
  reference: IrNode | undefined,
  contracts: Map<string, Readonly<ToolContract>>,
  diagnostics: Diagnostic[],
): { referenceBlockId: string; contract: Readonly<ToolContract> } | undefined {
  const parsed = readReference(reference, diagnostics);
  if (!parsed) return undefined;
  const contract = contracts.get(parsed.id);
  if (!contract) {
    diagnostics.push(error("TOOL_REFERENCE_MISSING", `找不到稳定工具 ID ${parsed.id}`, parsed.blockId));
    return undefined;
  }
  return { referenceBlockId: parsed.blockId, contract };
}

function canonicalArgumentRecord(raw: unknown): Record<string, JsonValue> | undefined {
  if (!isPlainJsonRecord(raw)) return undefined;
  try {
    const args = canonicalizeJson(raw);
    return isPlainJsonRecord(args) ? args : undefined;
  } catch {
    return undefined;
  }
}

function canonicalArgs(call: IrNode, diagnostics: Diagnostic[]): Record<string, JsonValue> | undefined {
  const hasArgs = hasField(call, "ARGS");
  const hasLegacyArguments = hasField(call, "ARGUMENTS");
  if (!hasArgs && hasLegacyArguments) {
    diagnostics.push(error("TOOL_CALL_ARGUMENTS_ALIAS_UNSUPPORTED", "工具调用只接受规范字段 ARGS，不支持 ARGUMENTS 别名", call.id));
    return undefined;
  }
  if (!hasArgs) return {};

  const args = canonicalArgumentRecord(call.fields?.ARGS);
  if (!args) {
    diagnostics.push(error("TOOL_CALL_INVALID_ARGUMENTS", "工具调用 ARGS 必须是 plain JSON 对象", call.id));
    return undefined;
  }
  if (hasLegacyArguments) {
    const legacyArgs = canonicalArgumentRecord(call.fields?.ARGUMENTS);
    if (!legacyArgs || JSON.stringify(args) !== JSON.stringify(legacyArgs)) {
      diagnostics.push(error("TOOL_CALL_ARGUMENT_FIELDS_CONFLICT", "工具调用 ARGS 与 ARGUMENTS 字段冲突", call.id));
      return undefined;
    }
  }
  return args;
}

export function resolveToolUsages(
  program: BlockyProgram,
  contracts: Map<string, Readonly<ToolContract>>,
): ToolUsageResult {
  const diagnostics: Diagnostic[] = [];
  const agentAttachments: ToolUsageResult["agentAttachments"] = [];
  const explicitCalls: ToolUsageResult["explicitCalls"] = [];

  for (const agent of allNodes(program).filter((node) => node.type === "core.agent.define")) {
    const members = agent.inputs?.MEMBERS;
    if (!members) continue;
    walk(members, (member) => {
      if (member.type !== "core.agent.add_tool") return;
      const resolved = resolveReference(member.inputs?.TOOL, contracts, diagnostics);
      if (resolved) agentAttachments.push({ agentId: agent.id, ...resolved });
    });
  }

  for (const callBlock of allNodes(program).filter((node) => node.type === "core.tool.call")) {
    const resolved = resolveReference(callBlock.inputs?.TOOL, contracts, diagnostics);
    if (!resolved) continue;
    const args = canonicalArgs(callBlock, diagnostics);
    if (!args) continue;
    const call: ToolCall = {
      callBlockId: callBlock.id,
      toolId: resolved.contract.id,
      args,
    };
    explicitCalls.push({ call, contract: resolved.contract });
    diagnostics.push(...validateToolArgs(resolved.contract, call.args).map((item) => ({ ...item, blockId: callBlock.id })));
  }

  return { agentAttachments, explicitCalls, diagnostics };
}
