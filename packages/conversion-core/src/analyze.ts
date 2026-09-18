import { parser as python } from "@lezer/python";
import { parser as javascript } from "@lezer/javascript";
import type { ExpressionProgram } from "@blocky/language-schema";
import {
  children,
  descendants,
  functionName,
  textAt,
  type SyntaxNode,
} from "./syntax";
import { lowerNumeric, type NumericStage } from "./numeric";
export type ConversionDecision =
  | "custom-block"
  | "blueprint"
  | "compatibility-draft"
  | "native-retained";
export type SymbolAnalysis = {
  name: string;
  kind: "function" | "class";
  lineStart: number;
  lineEnd: number;
  parameters: string[];
  calls: string[];
  effects: string[];
  dependencies: string[];
  decision: ConversionDecision;
  rationale: string;
  program?: ExpressionProgram;
  stages?: NumericStage[];
};
export type FileAnalysis = {
  path: string;
  language: string;
  parseErrors: number;
  symbols: SymbolAnalysis[];
  convertible: number;
  imports: string[];
  retained: string[];
};
export function analyzeFile(path: string, code: string): FileAnalysis {
  const language = /\.py$/i.test(path)
    ? "python"
    : /\.[cm]?[jt]sx?$/i.test(path)
      ? "javascript/typescript"
      : "unsupported";
  if (code.length > 2 * 1024 * 1024) throw Error("BLK-CONVERT-BUDGET");
  const result: FileAnalysis = {
    path,
    language,
    parseErrors: 0,
    symbols: [],
    convertible: 0,
    imports: [],
    retained: [],
  };
  if (language === "unsupported") {
    result.retained.push("未支持此语言的静态分析，原生保留。");
    return result;
  }
  const tree = (
    language === "python"
      ? python
      : javascript.configure({
          dialect: /\.[cm]?tsx?$/i.test(path) ? "ts jsx" : "jsx",
        })
  ).parse(code);
  const all = descendants(tree.topNode);
  result.parseErrors = all.filter((n) => n.type.isError).length;
  const top = children(tree.topNode)
    .filter((n) => n.name !== "Comment")
    .map((n) =>
      n.name === "ExportDeclaration"
        ? (n.getChild("FunctionDeclaration") ?? n)
        : n,
    );
  const functionNodes = all.filter((n) =>
    ["FunctionDefinition", "FunctionDeclaration"].includes(n.name),
  );
  const closed = new Map<string, SyntaxNode>();
  const moduleClosed = top.every((n) =>
    ["FunctionDefinition", "FunctionDeclaration"].includes(n.name),
  );
  let duplicate = false;
  for (const node of top)
    if (["FunctionDefinition", "FunctionDeclaration"].includes(node.name)) {
      const name = functionName(code, node);
      if (closed.has(name)) duplicate = true;
      closed.set(name, node);
    }
  if (duplicate || !moduleClosed) closed.clear();
  const line = (offset: number) => code.slice(0, offset).split("\n").length;
  for (const node of all.filter((n) =>
    /^(ImportStatement|ImportDeclaration)$/.test(n.name),
  ))
    result.imports.push(textAt(code, node).slice(0, 300));
  for (const node of [
    ...functionNodes,
    ...all.filter((n) =>
      ["ClassDefinition", "ClassDeclaration"].includes(n.name),
    ),
  ]) {
    if (result.symbols.length >= 1000) throw Error("BLK-CONVERT-BUDGET");
    const nested = descendants(node),
      isClass = node.name.startsWith("Class");
    const calls = [
      ...new Set(
        nested
          .filter((n) => n.name === "CallExpression")
          .map((n) =>
            n.firstChild ? textAt(code, n.firstChild).slice(0, 100) : "unknown",
          ),
      ),
    ];
    const loops = nested.some((n) =>
      /^(WhileStatement|ForStatement)$/.test(n.name),
    );
    const writes = nested.some((n) =>
      /^(AssignStatement|AssignmentExpression|UpdateExpression)$/.test(n.name),
    );
    const member = nested.some((n) => /MemberExpression/.test(n.name));
    const parameters = children(node.getChild("ParamList") ?? node)
      .filter((n) => ["VariableName", "VariableDefinition"].includes(n.name))
      .map((n) => textAt(code, n));
    const symbol: SymbolAnalysis = {
      name: functionName(code, node) || "anonymous",
      kind: isClass ? "class" : "function",
      lineStart: line(node.from),
      lineEnd: line(Math.max(node.from, node.to - 1)),
      parameters: isClass ? [] : parameters,
      calls,
      effects: [
        ...(calls.length ? ["调用行为需逐项核验"] : []),
        ...(loops ? ["循环"] : []),
        ...(writes ? ["状态写入"] : []),
        ...(member ? ["成员访问"] : []),
      ],
      dependencies: [],
      decision: "native-retained",
      rationale: "超出封闭数值表达式子集；未执行上游代码，也未生成可运行转换。",
    };
    if (
      isClass &&
      loops &&
      writes &&
      calls.length &&
      nested.filter((n) =>
        ["FunctionDefinition", "MethodDeclaration"].includes(n.name),
      ).length >= 2
    ) {
      symbol.decision = "compatibility-draft";
      symbol.rationale =
        "发现多个方法、运行循环、状态写入和调用边界；需继续审计会话/权限/扩展语义，仅生成兼容草案。";
    } else if (
      !isClass &&
      !result.parseErrors &&
      closed.get(symbol.name)?.from === node.from &&
      closed.get(symbol.name)?.to === node.to
    ) {
      try {
        const lowered = lowerNumeric(code, closed.get(symbol.name)!, closed);
        symbol.program = lowered.program;
        symbol.dependencies = lowered.dependencies;
        symbol.stages = lowered.stages;
        symbol.decision =
          (lowered.stages?.length ?? 0) > 1 ? "blueprint" : "custom-block";
        symbol.effects = [];
        symbol.rationale =
          symbol.decision === "blueprint"
            ? "封闭的本地纯函数组合，可展开为受限数值计算蓝图。"
            : "纯返回表达式，输入/中间值/输出均限制为绝对值不超过 1e9 的有限数；无 I/O 或源码执行。";
        result.convertible++;
      } catch {
        /* The unsupported portion remains visible as native-retained. */
      }
    }
    result.symbols.push(symbol);
  }
  if (result.parseErrors)
    result.retained.push("语法解析存在错误，整份文件禁止生成可执行转换。");
  if (!moduleClosed)
    result.retained.push("模块初始化、导入、装饰器及非函数顶层语义未转换。");
  if (!result.symbols.length)
    result.retained.push("没有可证明接口的函数或类，保留原生文件。");
  return result;
}
