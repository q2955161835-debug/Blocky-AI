import { z } from "zod";
const stable = z.string().min(1).max(200).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
export const rpaCaptureIdSchema = z.string().regex(/^capture-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const rpaCaptureSchema = z.object({
  schemaVersion: z.literal("blocky.rpa-capture/v1"), captureId: rpaCaptureIdSchema,
  checkpointId: z.string().max(80).regex(/^checkpoint-[a-z0-9]+(?:-[a-z0-9]+)*$/), planId: stable, stepId: stable,
  createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 86400000),
  expiresAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  width: z.number().int().min(1).max(2048), height: z.number().int().min(1).max(2048),
  bytes: z.number().int().min(1).max(4194304), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  maskedRegions: z.number().int().min(0).max(2048),
}).strict().refine(value => value.expiresAt === value.createdAt + 86400000);
export const rpaCaptureViewSchema = z.object({ capture: rpaCaptureSchema, dataUrl: z.string().max(5592430).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/) }).strict();
export type RpaCapture = z.infer<typeof rpaCaptureSchema>;
