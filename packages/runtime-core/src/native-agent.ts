import { implementationKey } from "@blocky/resource-registry";
import type { Json } from "@blocky/language-schema";
import type { AgentServices, Generation } from "./agent-context";
import { integer } from "./budget";
export type NativeAgentCall = (
  operation: string,
  fields: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<unknown>;
export type PendingApproval = {
  kind: "provider" | "tool" | "memory";
  requestDigest: string;
  preview: unknown;
};
export function nativeAgentServices(
  call: NativeAgentCall,
  options: {
    mode: "desktop" | "cli";
    live?: boolean;
    approved?: Set<string>;
    approve?: (value: PendingApproval, signal: AbortSignal) => Promise<boolean>;
    pending?: (value: PendingApproval) => void;
  } = { mode: "desktop" },
): AgentServices {
  const tokens = new Map<AbortSignal, string>();
  async function approved(
    kind: PendingApproval["kind"],
    operation: string,
    request: unknown,
    signal: AbortSignal,
  ) {
    const preview = (await call(operation, { request }, signal)) as {
      requestDigest: string;
    };
    if (!preview || !/^[a-f0-9]{64}$/.test(preview.requestDigest))
      throw Error("BLK-PERM-001");
    signal.throwIfAborted();
    if (
      !options.approved?.has(preview.requestDigest) &&
      !(await options.approve?.(
        { kind, requestDigest: preview.requestDigest, preview },
        signal,
      ))
    ) {
      options.pending?.({
        kind,
        requestDigest: preview.requestDigest,
        preview,
      });
      throw Error("BLK-APPROVAL-001");
    }
    return { approved: true, requestDigest: preview.requestDigest };
  }
  return {
    async generate(input, signal) {
      if (options.live === false) throw Error("BLK-PROVIDER-DISABLED");
      const resource = input.resource,
        d = resource.definition;
      const binding = resource.secretBindings.find(
        (b) => b.fieldId === "apiKey",
      );
      if (
        resource.scope !== "user" ||
        d.provider !== "deepseek" ||
        d.protocol !== "openai-chat" ||
        typeof d.modelId !== "string" ||
        !binding
      )
        throw Error("BLK-PROVIDER-CONFIG");
      const p = d.parameters as Record<string, Json> | undefined;
      if (
        p &&
        Object.keys(p).some(
          (k) => !["temperature", "maxOutputTokens"].includes(k),
        )
      )
        throw Error("BLK-PROVIDER-CONFIG");
      const request = {
        schemaVersion: "blocky.provider-request/v1",
        requestId: input.requestId,
        projectId: input.projectId,
        resourceId: resource.resourceId,
        secretRef: binding.secretRef,
        modelId: d.modelId,
        messages: input.messages,
        maxOutputTokens: Math.min(1024, input.maxOutputTokens),
        timeoutMs: integer(d.timeoutMs, 1, 120000),
        ...(p?.temperature !== undefined ? { temperature: p.temperature } : {}),
      };
      const approval =
        options.mode === "cli"
          ? await approved("provider", "provider-preflight", request, signal)
          : undefined;
      signal.throwIfAborted();
      const cancel = () => {
        if (options.mode === "desktop")
          void call("provider-cancel", { requestId: input.requestId }).catch(
            () => {},
          );
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        return (await call(
          "provider-call",
          { request, ...(approval ? { approval } : {}) },
          signal,
        )) as Generation;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
    async memory(request, signal) {
      if (options.mode === "cli") {
        const approval = await approved(
          "memory",
          "agent-memory-preflight",
          request,
          signal,
        );
        signal.throwIfAborted();
        const value = (await call(
          "agent-memory",
          { request, approval },
          signal,
        )) as { value?: Json };
        return value.value ?? null;
      }
      let token = tokens.get(signal);
      if (!token) {
        const result = (await call(
          "agent-memory-authorize",
          { projectId: request.projectId, sessionId: request.sessionId },
          signal,
        )) as { token: string };
        token = result.token;
        if (signal.aborted) {
          await call("agent-memory-cancel", { token });
          signal.throwIfAborted();
        }
        tokens.set(signal, token);
      }
      signal.throwIfAborted();
      const value = (await call(
        "agent-memory",
        { token, request },
        signal,
      )) as { value?: Json };
      return value.value ?? null;
    },
    async tool(input, signal) {
      const permissions = input.resource.definition.permissions;
      if (
        !Array.isArray(permissions) ||
        permissions.length !== 1 ||
        permissions[0] !== "text.analyze" ||
        input.resource.capabilityRequirements.length !== 1 ||
        input.resource.capabilityRequirements[0] !== "text.analyze"
      )
        throw Error("BLK-TOOL-001");
      if (
        implementationKey(input.resource.definition.implementationRef) !==
          "adapter://text-analyze-v1" ||
        input.resource.definition.version !== "1" ||
        typeof input.input !== "string"
      )
        throw Error("BLK-TOOL-002");
      const request = {
        schemaVersion: "blocky.tool-request/v1",
        projectId: input.projectId,
        runId: input.runId,
        requestId: input.requestId,
        toolId: "text.analyze/v1",
        input: input.input,
      };
      const approval =
        options.mode === "cli"
          ? await approved("tool", "agent-tool-preflight", request, signal)
          : undefined;
      const cancel = () => {
        if (options.mode === "desktop")
          void call("agent-tool-cancel", { requestId: input.requestId }).catch(
            () => {},
          );
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        signal.throwIfAborted();
        return (await call(
          options.mode === "cli" ? "agent-tool" : "agent-tool-call",
          { request, ...(approval ? { approval } : {}) },
          signal,
        )) as Json;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
    async close(signal) {
      const token = tokens.get(signal);
      tokens.delete(signal);
      if (token) await call("agent-memory-cancel", { token }).catch(() => {});
    },
  };
}
