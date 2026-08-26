import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  RuntimeModelError,
  type ModelCallReport,
  type RuntimeDependencies,
} from "../core/deterministicRuntime";

const responseSchema = z.strictObject({
  content: z.string().min(1),
  provider: z.literal("deepseek"),
  model: z.string().min(1),
  requestId: z.string().min(1),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

function stableProviderError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^DEEPSEEK_[A-Z0-9_]+$/u.test(code)) return code;
  }
  return "DEEPSEEK_REQUEST_FAILED";
}

export function createTauriDeepSeekModel(): RuntimeDependencies["model"] {
  let lastReport: ModelCallReport | null = null;
  return {
    async *stream(input: string, signal: AbortSignal): AsyncIterable<string> {
      lastReport = null;
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const requestId = crypto.randomUUID();
      let rejectAbort!: (reason: DOMException) => void;
      const abortPromise = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
      });
      const abort = () => {
        void invoke("cancel_deepseek_completion", { requestId }).catch(() => undefined);
        rejectAbort(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      let raw: unknown;
      try {
        raw = await Promise.race([
          invoke("deepseek_chat_completion", { request: { input, requestId } }),
          abortPromise,
        ]);
      } catch (error) {
        if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          throw new DOMException("Aborted", "AbortError");
        }
        throw new RuntimeModelError(stableProviderError(error));
      } finally {
        signal.removeEventListener("abort", abort);
      }
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) throw new RuntimeModelError("DEEPSEEK_RESPONSE_INVALID");
      lastReport = Object.freeze({
        live: true,
        provider: parsed.data.provider,
        model: parsed.data.model,
        requestId: parsed.data.requestId,
        promptTokens: parsed.data.promptTokens,
        completionTokens: parsed.data.completionTokens,
        totalTokens: parsed.data.totalTokens,
      });
      yield parsed.data.content;
    },
    takeLastCallReport(): ModelCallReport | null {
      const report = lastReport;
      lastReport = null;
      return report;
    },
  };
}
