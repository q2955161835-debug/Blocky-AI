import { z } from "zod";
import { containsCredential, stableId } from "@blocky/language-schema";
const publicId = z.string().min(1).max(128).regex(stableId).refine(value => !containsCredential(value));
/** Runtime identities and outcomes only; never tool arguments or results. */
export const runtimeActivitySchema = z.object({
  callId: publicId,
  kind: z.enum(["model", "tool"]),
  status: z.enum(["started", "completed", "failed", "cancelled"]),
  toolId: publicId.optional(),
  operation: publicId.optional(),
  code: z.string().max(128).regex(/^BLK-[A-Z0-9-]+$/).optional(),
}).strict();
export type RuntimeActivity = z.infer<typeof runtimeActivitySchema>;
