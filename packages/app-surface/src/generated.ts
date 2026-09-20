import { z } from "zod";
import {
  canonicalJson,
  type Json,
  type Project,
  type Resource,
} from "@blocky/language-schema";
import { draftSurface } from "./draft";
import { validateSurface } from "./manifest";
import generated from "./generated-sources.json";
const text = z.string().min(1).max(200);
export const surfaceSpecSchema = z
  .object({
    schemaVersion: z.literal("blocky.surface-spec/v1"),
    title: z.string().min(1).max(100),
    description: z.string().max(1000),
    layout: z.enum(["stack", "split"]),
    submitLabel: text,
    resultLabel: text,
    attachment: z.boolean(),
    confirmation: z.boolean(),
    fields: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
            label: text,
            type: z.enum(["text", "textarea", "select"]),
            required: z.boolean(),
            options: z.array(text).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .superRefine((s, c) => {
    if (
      new Set(s.fields.map((f) => f.id)).size !== s.fields.length ||
      s.fields.some((f) =>
        f.type === "select" ? f.options.length === 0 : f.options.length !== 0,
      )
    )
      c.addIssue({ code: "custom", message: "invalid fields" });
  });
export type SurfaceSpec = z.infer<typeof surfaceSpecSchema>;
export function parseSurfaceSpec(input: unknown): SurfaceSpec {
  try {
    return surfaceSpecSchema.parse(input);
  } catch {
    throw Error("BLK-SURFACE-002");
  }
}
export function generatedSourceFiles(
  surfaceId: string,
  input: unknown,
): Record<string, Json> {
  const spec = parseSurfaceSpec(input),
    base = `surfaces/${surfaceId}`;
  const encoded = canonicalJson(spec)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const files: Record<string, Json> = {};
  for (const [path, value] of Object.entries(generated.files))
    files[`${base}/${path}`] = path.endsWith(".json")
      ? JSON.parse(value)
      : value.replace("<!--BLOCKY_SPEC-->", encoded);
  files[`${base}/surface-spec.json`] = spec;
  return files;
}
export async function draftGeneratedSurface(
  project: Project,
  moduleId: string,
  intent: "explicit-user-command" | "agent-request",
  input: unknown,
  registry?: Map<string, Resource>,
) {
  if (intent !== "explicit-user-command") throw Error("BLK-SURFACE-001");
  const spec = parseSurfaceSpec(input),
    legacy = await draftSurface(project, moduleId, intent, registry);
  const manifest = {
    ...legacy.manifest,
    schemaVersion: "blocky.app-surface/v1" as const,
    displayName: spec.title,
  };
  const base = `surfaces/${manifest.surfaceId}`;
  return validateSurface(project, {
    manifest,
    files: {
      ...generatedSourceFiles(manifest.surfaceId, spec),
      [`${base}/manifest.json`]: manifest,
      [manifest.bridgeRef]: legacy.files[manifest.bridgeRef],
    },
  });
}
