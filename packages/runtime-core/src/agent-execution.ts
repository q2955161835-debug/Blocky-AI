import {
  stableId,
  type IrNode,
  type Json,
  type Project,
  type Resource,
} from "@blocky/language-schema";
import { resolveResource, implementationKey } from "@blocky/resource-registry";
import type { Citation } from "./adapters";
import { abortable, integer, RunBudget, utf8 } from "./budget";
import {
  checkGeneration,
  checkGenerationMetadata,
  messages,
  type AgentServices,
  type Generation,
  type OutputFile,
} from "./agent-context";
import { validateOutput } from "./output-schema";

/** Run-local values; persistence and external effects belong to injected Host ports. */
export class AgentExecution {
  value: Json = null;
  memory: Json = null;
  instruction = "";
  requireEvidence = false;
  generated: string | undefined;
  structured: Json | undefined;
  files: OutputFile[] = [];
  generations: Generation[] = [];
  constructor(
    readonly project: Project,
    readonly question: string,
    readonly runId: string,
    readonly sessionId: string,
    readonly budget: RunBudget,
    readonly services: AgentServices = {},
    readonly registry?: Map<string, Resource>,
    private sessionMemory = new Map<string, Json>(),
  ) {}
  async compose(
    resource: Resource,
    role: string,
    citations: Citation[],
    requestId: string,
  ): Promise<boolean> {
    const key = implementationKey(resource.definition.implementationRef);
    if (
      ![
        "adapter://deepseek-v1",
        "adapter://xirang-v1",
        "adapter://generator-v1",
      ].includes(key)
    )
      return false;
    if (this.requireEvidence && !citations.length) {
      this.generated = "资料没有提供足够依据，请补充资料或澄清问题。";
      this.value = this.generated;
      return true;
    }
    this.budget.call();
    const parameters = resource.definition.parameters as
      | Record<string, Json>
      | undefined;
    const limit = this.budget.reserveOutput(
      integer(parameters?.maxOutputTokens ?? 1024, 1, 4096),
    );
    const input = messages(
      role,
      this.instruction,
      this.question,
      this.memory,
      this.value,
      citations,
    );
    let result: Generation;
    if (key === "adapter://generator-v1") {
      result = {
        text: citations.length
          ? citations.map((c) => `${c.text} [source:${c.id}]`).join("\n")
          : this.value === null
            ? "没有可核实的资料，请补充信息。"
            : JSON.stringify(this.value),
        provider: "deterministic",
        transport: "local",
        model: "generator-v1",
        requestId,
        usage: null,
      };
    } else {
      if (!this.services.generate) throw Error("BLK-MODEL-001");
      result = await abortable(
        this.services.generate(
          {
            projectId: this.project.manifest.projectId,
            resource,
            messages: input,
            maxOutputTokens: limit,
            requestId,
          },
          this.budget.signal,
        ),
        this.budget.signal,
      );
    }
    this.budget.check();
    checkGenerationMetadata(result);
    this.generations.push({ ...result, text: "" });
    if (this.services.validateCitations)
      await abortable(
        this.services.validateCitations(
          this.project.manifest.projectId,
          citations,
          this.budget.signal,
        ),
        this.budget.signal,
      );
    checkGeneration(result, citations, this.requireEvidence);
    if (result.usage && result.usage.outputTokens > limit)
      throw Error("BLK-RUN-004");
    this.generations[this.generations.length - 1] = result;
    this.generated = result.text;
    this.value = result.text;
    return true;
  }
  async execute(
    node: IrNode,
    execute: (node: IrNode) => Promise<void>,
  ): Promise<boolean> {
    const f = node.fields;
    switch (node.blockType) {
      case "core.run.budget":
        this.budget.configure(f);
        break;
      case "core.prompt.context":
        if (
          typeof f.TEXT !== "string" ||
          utf8(this.instruction + f.TEXT) > 8192
        )
          throw Error("BLK-CONTEXT-001");
        this.instruction += "\n" + f.TEXT;
        break;
      case "core.data.set":
        if (typeof f.VALUE !== "string" || utf8(f.VALUE) > 32768)
          throw Error("BLK-TYPE-009");
        try {
          this.value = JSON.parse(f.VALUE) as Json;
        } catch {
          throw Error("BLK-TYPE-009");
        }
        break;
      case "core.logic.condition": {
        if (
          !["input", "result", "memory"].includes(String(f.SOURCE)) ||
          !["equals", "contains", "truthy"].includes(String(f.OP))
        )
          throw Error("BLK-TYPE-009");
        const value =
          f.SOURCE === "input"
            ? this.question
            : f.SOURCE === "result"
              ? this.value
              : this.memory;
        const text = typeof value === "string" ? value : JSON.stringify(value);
        const condition =
          f.OP === "truthy"
            ? Boolean(value)
            : f.OP === "equals"
              ? text === f.VALUE
              : text.includes(String(f.VALUE ?? ""));
        const child = node.inputs[condition ? "THEN" : "ELSE"];
        if (Array.isArray(child)) throw Error("BLK-TYPE-009");
        if (child) await execute(child);
        break;
      }
      case "core.memory.read":
      case "core.memory.write":
      case "core.memory.delete": {
        if (
          !["session", "project"].includes(String(f.SCOPE)) ||
          typeof f.KEY !== "string" ||
          !stableId.test(f.KEY)
        )
          throw Error("BLK-MEMORY-001");
        if (
          node.blockType.endsWith("write") &&
          !["input", "result"].includes(String(f.SOURCE))
        )
          throw Error("BLK-TYPE-009");
        const action = node.blockType.split(".").at(-1) as
          | "read"
          | "write"
          | "delete";
        const value = f.SOURCE === "input" ? this.question : this.value;
        if (utf8(JSON.stringify(value)) > 32768) throw Error("BLK-MEMORY-001");
        this.budget.call();
        if (f.SCOPE === "session") {
          const key = JSON.stringify([
            this.project.manifest.projectId,
            this.sessionId,
            f.KEY,
          ]);
          if (action === "delete") this.sessionMemory.delete(key);
          if (action === "write") {
            const candidate = new Map(this.sessionMemory);
            candidate.set(key, structuredClone(value));
            if (utf8(JSON.stringify([...candidate])) > 1048576)
              throw Error("BLK-MEMORY-001");
            this.sessionMemory.set(key, structuredClone(value));
          }
          this.memory = structuredClone(this.sessionMemory.get(key) ?? null);
        } else {
          if (!this.services.memory) throw Error("BLK-MEMORY-001");
          this.memory = await abortable(
            this.services.memory(
              {
                requestId: `${this.runId}-memory-${this.budget.calls}`,
                projectId: this.project.manifest.projectId,
                sessionId: this.sessionId,
                scope: "project",
                key: f.KEY,
                action,
                ...(action === "write" ? { value } : {}),
              },
              this.budget.signal,
            ),
            this.budget.signal,
          );
        }
        this.budget.check();
        if (utf8(JSON.stringify(this.memory)) > 32768)
          throw Error("BLK-MEMORY-001");
        if (action === "read") this.value = this.memory;
        break;
      }
      case "core.tool.invoke": {
        const resource = resolveResource(
          this.project,
          String(f.RESOURCE),
          "tool",
          this.registry,
        );
        if (
          !this.services.tool ||
          !["input", "result"].includes(String(f.SOURCE))
        )
          throw Error("BLK-TOOL-001");
        if (resource.definition.version !== "1") throw Error("BLK-TOOL-003");
        const input = f.SOURCE === "input" ? this.question : this.value;
        for (const [kind, value] of [["inputSchemaRef", input]] as const)
          this.validateResourceSchema(resource, kind, value);
        this.budget.call();
        const value = await abortable(
          this.services.tool(
            {
              projectId: this.project.manifest.projectId,
              runId: this.runId,
              resource,
              input,
              requestId: `${this.runId}-${node.nodeId}-${this.budget.calls}`,
            },
            this.budget.signal,
          ),
          this.budget.signal,
        );
        this.budget.check();
        this.validateResourceSchema(resource, "outputSchemaRef", value);
        this.value = value;
        break;
      }
      case "core.guardrail.evidence":
        if (!["require", "optional"].includes(String(f.POLICY)))
          throw Error("BLK-GUARD-001");
        this.requireEvidence = f.POLICY === "require";
        break;
      case "core.output.structured": {
        const schema = this.project.schemas[String(f.SCHEMA)];
        let value = this.value;
        if (
          typeof value === "string" &&
          (!schema ||
            typeof schema !== "object" ||
            Array.isArray(schema) ||
            schema.type !== "string")
        ) {
          try {
            value = JSON.parse(value) as Json;
          } catch {
            throw Error("BLK-OUTPUT-001");
          }
        }
        if (!schema) throw Error("BLK-OUTPUT-001");
        validateOutput(value, schema);
        this.structured = value;
        break;
      }
      case "core.output.file": {
        const name = String(f.NAME),
          format = f.FORMAT;
        if (
          !/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u.test(name) ||
          /[. ]$/.test(name) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ||
          !["text", "json"].includes(String(format)) ||
          this.files.length >= 8
        )
          throw Error("BLK-OUTPUT-002");
        const content =
          format === "json"
            ? JSON.stringify(this.structured ?? this.value, null, 2)
            : (this.generated ??
              (typeof this.value === "string"
                ? this.value
                : JSON.stringify(this.value)));
        if (utf8(content) > 65536) throw Error("BLK-OUTPUT-002");
        this.files.push({ name, format: format as "text" | "json", content });
        break;
      }
      default:
        return false;
    }
    this.budget.check();
    return true;
  }
  private validateResourceSchema(
    resource: Resource,
    field: string,
    value: Json,
  ) {
    const ref = resource.definition[field];
    if (
      !ref ||
      typeof ref !== "object" ||
      Array.isArray(ref) ||
      ref.kind !== "schema" ||
      typeof ref.id !== "string"
    )
      throw Error("BLK-TOOL-003");
    const schema = this.project.schemas[`schemas/${ref.id}.json`];
    if (!schema) throw Error("BLK-TOOL-003");
    validateOutput(value, schema);
  }
}
