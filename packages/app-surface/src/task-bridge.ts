import { z } from "zod";
import type { SurfaceSpec } from "./generated";
import { validateBridgeRequest } from "./preview";
const request = z
  .object({
    schemaVersion: z.literal("blocky.bridge-request/v1"),
    requestId: z.string().regex(/^[a-z][a-z0-9-]{0,100}$/),
    endpointId: z.literal("ask"),
    values: z.record(z.string(), z.string().max(2000)),
    attachment: z
      .object({
        name: z
          .string()
          .min(1)
          .max(200)
          .regex(/^[^/\\\x00-\x1f]+\.(txt|md|csv)$/i),
        text: z.string().max(16000),
      })
      .strict()
      .optional(),
  })
  .strict();
export const cancelRequest = z
  .object({
    schemaVersion: z.literal("blocky.bridge-cancel/v1"),
    requestId: z.string().regex(/^[a-z][a-z0-9-]{0,100}$/),
  })
  .strict();
export function taskQuestion(input: unknown, spec?: SurfaceSpec) {
  if (!spec) return validateBridgeRequest(input);
  try {
    const parsed = request.parse(input);
    if (
      Object.keys(parsed.values).length !== spec.fields.length ||
      (parsed.attachment && !spec.attachment)
    )
      throw Error();
    const parts = spec.fields.map((f) => {
      const value = parsed.values[f.id];
      if (
        typeof value !== "string" ||
        (f.required && !value.trim()) ||
        (f.type === "select" && !f.options.includes(value))
      )
        throw Error();
      return `${f.label}: ${value}`;
    });
    if (parsed.attachment) {
      if (new TextEncoder().encode(parsed.attachment.text).length > 16000)
        throw Error();
      parts.push(`附件 ${parsed.attachment.name}:\n${parsed.attachment.text}`);
    }
    const question = parts.join("\n");
    if (new TextEncoder().encode(question).length > 16000) throw Error();
    return { requestId: parsed.requestId, question };
  } catch {
    throw Error("BLK-SURFACE-002");
  }
}
