import type { Diagnostic } from "./diagnostics";
import { SPIKE_BLOCK_SPECS, type BlockyProgram, type ConnectionShape, type IrNode } from "./ir";
import { canonicalizeJson, type JsonValue } from "./json";

export interface CompileResult {
  program: BlockyProgram;
  sourceMap: Record<string, { nodeId: string }>;
  diagnostics: Diagnostic[];
}

type JsonRecord = { [key: string]: JsonValue };

type SerializedBlock = {
  id: string;
  type: string;
  fields?: JsonRecord;
  inputs?: Record<string, { block?: JsonValue }>;
  next?: { block?: JsonValue };
};

function asRecord(value: JsonValue): JsonRecord | undefined {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? value
    : undefined;
}

function structuralDiagnostic(message: string, blockId?: string): Diagnostic {
  return { code: "IR_INVALID_WORKSPACE", message, severity: "error", ...(blockId ? { blockId } : {}) };
}

function connectionDiagnostic(
  blockId: string,
  inputName: string,
  expected: ConnectionShape,
  actual: ConnectionShape | undefined,
): Diagnostic {
  return {
    code: "IR_INVALID_CONNECTION",
    message: `积木 ${blockId} 的连接 ${inputName} 需要 ${expected}，实际为 ${actual ?? "无效连接"}`,
    severity: "error",
    blockId,
  };
}

function invalidNextDiagnostic(blockId: string): Diagnostic {
  return {
    code: "IR_INVALID_CONNECTION",
    message: `积木 ${blockId} 没有 next 连接器，不能声明后续积木`,
    severity: "error",
    blockId,
  };
}

function countBlockIds(value: JsonValue, counts: Map<string, number>): void {
  const record = asRecord(value);
  if (!record) return;
  if (typeof record.id === "string") {
    counts.set(record.id, (counts.get(record.id) ?? 0) + 1);
  }
  const inputs = asRecord(record.inputs ?? null);
  for (const rawConnection of Object.values(inputs ?? {})) {
    const connection = asRecord(rawConnection);
    if (connection?.block !== undefined) countBlockIds(connection.block, counts);
  }
  const next = asRecord(record.next ?? null);
  if (next?.block !== undefined) countBlockIds(next.block, counts);
}

function parseBlock(value: JsonValue, diagnostics: Diagnostic[]): SerializedBlock | undefined {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string" || typeof record.type !== "string") {
    diagnostics.push(structuralDiagnostic("积木必须包含字符串 id 和 type"));
    return undefined;
  }

  const fields = record.fields === undefined ? undefined : asRecord(record.fields);
  if (record.fields !== undefined && !fields) {
    diagnostics.push(structuralDiagnostic("积木 fields 必须是对象", record.id));
  }

  const inputsRecord = record.inputs === undefined ? undefined : asRecord(record.inputs);
  const inputs: Record<string, { block?: JsonValue }> = {};
  if (record.inputs !== undefined && !inputsRecord) {
    diagnostics.push(structuralDiagnostic("积木 inputs 必须是对象", record.id));
  }
  for (const [name, rawConnection] of Object.entries(inputsRecord ?? {})) {
    const connection = asRecord(rawConnection);
    if (!connection) {
      diagnostics.push(structuralDiagnostic(`积木输入 ${name} 必须是对象`, record.id));
      continue;
    }
    inputs[name] = connection.block === undefined ? {} : { block: connection.block };
  }

  const nextRecord = record.next === undefined ? undefined : asRecord(record.next);
  if (record.next !== undefined && !nextRecord) {
    diagnostics.push(structuralDiagnostic("积木 next 必须是对象", record.id));
  }

  return {
    id: record.id,
    type: record.type,
    ...(fields ? { fields } : {}),
    ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
    ...(nextRecord ? { next: nextRecord.block === undefined ? {} : { block: nextRecord.block } } : {}),
  };
}

export function compileWorkspace(serializedWorkspace: unknown): CompileResult {
  const state = canonicalizeJson(serializedWorkspace);
  const diagnostics: Diagnostic[] = [];
  const sourceMap: Record<string, { nodeId: string }> = {};

  const rootRecord = asRecord(state);
  const blocksRecord = rootRecord && asRecord(rootRecord.blocks);
  const rawRoots = blocksRecord?.blocks;
  if (!Array.isArray(rawRoots)) {
    diagnostics.push(structuralDiagnostic("工作区 blocks.blocks 必须是数组"));
    return {
      program: { schemaVersion: "blocky.ir/v0-spike", roots: [] },
      sourceMap,
      diagnostics,
    };
  }

  const blockIdCounts = new Map<string, number>();
  rawRoots.forEach((root) => countBlockIds(root, blockIdCounts));
  const conflictedBlockIds = new Set(
    [...blockIdCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id),
  );
  for (const blockId of [...conflictedBlockIds].sort((left, right) => left.localeCompare(right))) {
    diagnostics.push({
      code: "IR_DUPLICATE_BLOCK_ID",
      message: `积木 ID ${blockId} 重复`,
      severity: "error",
      blockId,
    });
  }

  const compileBlock = (rawBlock: JsonValue, expected?: ConnectionShape, owner?: { id: string; input: string }): IrNode | undefined => {
    const block = parseBlock(rawBlock, diagnostics);
    if (!block) return undefined;
    if (conflictedBlockIds.has(block.id)) return undefined;
    const spec = SPIKE_BLOCK_SPECS[block.type];
    if (!spec) {
      diagnostics.push({
        code: "IR_UNKNOWN_BLOCK_TYPE",
        message: `积木 ${block.id} 使用了 Spike 目录外的类型 ${block.type}`,
        severity: "error",
        blockId: block.id,
      });
    }
    sourceMap[block.id] = { nodeId: block.id };

    const actual = expected && spec ? spec.output ?? spec.previous : undefined;
    if (expected && actual !== expected && owner) {
      diagnostics.push(connectionDiagnostic(owner.id, owner.input, expected, actual));
    }

    const inputs: Record<string, IrNode | null> = {};
    for (const [name, connection] of Object.entries(block.inputs ?? {})) {
      const inputExpected = spec?.inputs?.[name];
      if (!inputExpected) {
        diagnostics.push(connectionDiagnostic(block.id, name, "type.json", undefined));
      }
      if (connection.block !== undefined) {
        const child = compileBlock(connection.block, inputExpected, { id: block.id, input: name });
        inputs[name] = child ?? null;
      } else {
        inputs[name] = null;
      }
    }

    let next: IrNode | null = null;
    if (block.next?.block !== undefined) {
      if (!spec?.next) {
        diagnostics.push(invalidNextDiagnostic(block.id));
      } else {
        const child = compileBlock(block.next.block, spec.next, { id: block.id, input: "next" });
        if (child) next = child;
      }
    }

    return {
      id: block.id,
      type: block.type,
      fields: block.fields ?? {},
      inputs,
      next,
    };
  };

  const roots = rawRoots
    .map((root) => compileBlock(root))
    .filter((root): root is IrNode => root !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    program: { schemaVersion: "blocky.ir/v0-spike", roots },
    sourceMap,
    diagnostics,
  };
}
