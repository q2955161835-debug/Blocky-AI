import { z } from "zod";
import { stableId } from "@blocky/language-schema";
import sources from "./sources.json";
import generated from "./generated-sources.json";
import type { SurfaceDraft } from "./manifest";
export const previewSandbox = "allow-scripts";
export function previewDocument(draft: SurfaceDraft) {
  const hash =
    draft.manifest.schemaVersion === "blocky.app-surface/v1"
      ? generated.scriptHash
      : sources.scriptHash;
  const source = (name: string) => {
    const value = draft.files[`${draft.manifest.sourceRootRef}/${name}`];
    if (typeof value !== "string") throw Error("BLK-SURFACE-002");
    return value;
  };
  const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; base-uri 'none'; form-action 'none'`;
  return source("page.html")
    .replace(
      "<head>",
      `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`,
    )
    .replace(
      '<link rel="stylesheet" href="page.css">',
      `<style>${source("page.css")}</style>`,
    )
    .replace(
      '<script src="page.js"></script>',
      `<script>${source("page.js")}</script>`,
    );
}
const request = z
  .object({
    schemaVersion: z.literal("blocky.bridge-request/v1alpha1"),
    requestId: z.string().regex(stableId).max(200),
    endpointId: z.literal("ask"),
    question: z.string().trim().min(1).max(4000),
  })
  .strict();
export function validateBridgeRequest(input: unknown) {
  try {
    return request.parse(input);
  } catch {
    throw Error("BLK-SURFACE-002");
  }
}
