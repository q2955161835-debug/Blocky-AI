import { codingResultSchema, type CodingResult } from "@blocky/builder-protocol";

/** Safe provider accounting accompanies a rejected response, never its raw body. */
export class CodingGenerationError extends Error {
  readonly generation?: CodingResult["generations"][number];

  constructor(code: string, generation?: unknown) {
    super(code);
    if (generation !== undefined)
      this.generation = codingResultSchema.shape.generations.element.parse(generation);
  }
}
