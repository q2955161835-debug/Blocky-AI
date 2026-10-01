import { implementationKey } from "@blocky/resource-registry";
import type { Json } from "@blocky/language-schema";
import type { AgentServices, Generation } from "./agent-context";
import { nativeModelRequest } from "./native-model";
export type NativeAgentCall = (
  operation: string,
  fields: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<unknown>;
export type PendingApproval = {
  kind: "provider" | "tool" | "memory" | "skill" | "media" | "decision" | "evaluation";
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
  const authorizations = new Map<AbortSignal, Promise<string>>();
  const active = new Map<AbortSignal, Set<Promise<unknown>>>();
  const native = call;
  call = async (operation, fields, signal) => {
    const pending = native(operation, fields, signal);
    if (!signal) return pending;
    let requests = active.get(signal);
    if (!requests) active.set(signal, (requests = new Set()));
    requests.add(pending);
    try {
      return await pending;
    } finally {
      requests.delete(pending);
      if (!requests.size) active.delete(signal);
    }
  };
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
  async function tokenFor(projectId: string, sessionId: string, signal: AbortSignal): Promise<string> {
    const token = tokens.get(signal);
    if (token) return token;
    let pending = authorizations.get(signal);
    if (!pending) {
      pending = (async () => {
        const result = await call("agent-memory-authorize", { projectId, sessionId }, signal) as {token:string};
        if (signal.aborted) { await call("agent-memory-cancel", {token:result.token}); signal.throwIfAborted(); }
        tokens.set(signal,result.token); return result.token;
      })();
      authorizations.set(signal,pending);
    }
    try { return await pending; } finally { if (authorizations.get(signal) === pending) authorizations.delete(signal); }
  }
  return {
    async evaluation(request,signal){
      const approval=options.mode==='cli'?await approved('evaluation','agent-evaluation-preflight',request,signal):undefined;
      const token=options.mode==='desktop'?await tokenFor(request.projectId,request.sessionId,signal):undefined;
      signal.throwIfAborted();return await call('agent-evaluation',{request,...(approval?{approval}:{token})},signal) as Json;
    },
    async decision(request,signal){
      const approval=options.mode==='cli'?await approved('decision','agent-decision-preflight',request,signal):undefined;
      const token=options.mode==='desktop'?await tokenFor(request.projectId,request.sessionId,signal):undefined;
      const cancel=()=>{if(token)void call('agent-decision-cancel',{token,requestId:request.requestId}).catch(()=>{});};
      signal.addEventListener('abort',cancel,{once:true});
      try{signal.throwIfAborted();return await call('agent-decision',{request,...(approval?{approval}:{token})},signal) as Json;}finally{signal.removeEventListener('abort',cancel);}
    },
    async media(request,signal){
      const approval=options.mode==='cli'?await approved('media','agent-media-preflight',request,signal):undefined;
      const token=options.mode==='desktop'?await tokenFor(request.projectId,request.sessionId,signal):undefined;
      const cancel=()=>{if(token)void call('agent-media-cancel',{token,requestId:request.requestId}).catch(()=>{});};
      signal.addEventListener('abort',cancel,{once:true});
      try{signal.throwIfAborted();return await call('agent-media',{request,...(approval?{approval}:{token})},signal) as Json;}finally{signal.removeEventListener('abort',cancel);}
    },
    async skills(request,signal) {
      const approval=options.mode==='cli'?await approved('skill','agent-skill-preflight',request,signal):undefined;
      const token=options.mode==='desktop'?await tokenFor(request.projectId,request.sessionId,signal):undefined;
      signal.throwIfAborted();return await call('agent-skill',{request,...(approval?{approval}:{token})},signal) as Json;
    },
    async generate(input, signal) {
      if (options.live === false) throw Error("BLK-PROVIDER-DISABLED");
      const model = nativeModelRequest(input),
        request = model.request;
      const approval =
        options.mode === "cli"
          ? await approved("provider", model.preflight, request, signal)
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
          model.call,
          { request, ...(approval ? { approval } : {}) },
          signal,
        )) as Generation;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
    async memoryEntries(request, signal) {
      const approval = options.mode === "cli" ? await approved("memory", "agent-memory-manage-preflight", request, signal) : undefined;
      const token = options.mode === "desktop" ? await tokenFor(request.projectId, request.sessionId, signal) : undefined;
      signal.throwIfAborted();
      return await call("agent-memory-manage", {request, ...(approval ? {approval} : {token})},signal) as Json;
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
      const token = await tokenFor(request.projectId, request.sessionId, signal);
      signal.throwIfAborted();
      const value = (await call(
        "agent-memory",
        { token, request },
        signal,
      )) as { value?: Json };
      return value.value ?? null;
    },
    async tool(input, signal) {
      const implementation = implementationKey(
        input.resource.definition.implementationRef,
      );
      if (
        [
          "adapter://http-json-v1",
          "adapter://search-json-v1",
          "adapter://mcp-tool-v1",
        ].includes(implementation)
      ) {
        const request = {
          schemaVersion: "blocky.tool-request/v2",
          projectId: input.projectId,
          runId: input.runId,
          requestId: input.requestId,
          resourceId: input.resource.resourceId,
          action: "call",
          input: input.input,
          timeoutMs: input.resource.definition.timeoutMs,
        };
        const approval =
          options.mode === "cli"
            ? await approved("tool", "tool-preflight", request, signal)
            : undefined;
        signal.throwIfAborted();
        const cancel = () => {
          if (options.mode === "desktop")
            void call("tool-cancel", { requestId: input.requestId }).catch(
              () => {},
            );
        };
        signal.addEventListener("abort", cancel, { once: true });
        try {
          return (await call(
            "tool-call",
            { request, ...(approval ? { approval } : {}) },
            signal,
          )) as Json;
        } finally {
          signal.removeEventListener("abort", cancel);
        }
      }
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
      await Promise.allSettled([...(active.get(signal) ?? [])]);
      const token = tokens.get(signal);
      tokens.delete(signal);
      if (token) await call("agent-memory-cancel", { token }).catch(() => {});
    },
  };
}
