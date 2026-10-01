import { digest, type Json, type Resource } from "@blocky/language-schema";
import { implementationKey } from "@blocky/resource-registry";
import { evaluationModelBindingSchema, type EvaluationModelBinding } from "./schema";

/** Bind the declared model identity, including the legacy local text composer. */
export async function createEvaluationModelBinding(
  resource: Resource,
): Promise<EvaluationModelBinding> {
  if (resource.kind !== "model") throw Error("BLK-EVAL-MODEL-BINDING");
  let provider = resource.definition.provider;
  let modelId = resource.definition.modelId;
  if (provider === undefined && modelId === undefined) {
    let adapter: string;
    try {
      adapter = implementationKey(resource.definition.implementationRef);
    } catch {
      throw Error("BLK-EVAL-MODEL-BINDING");
    }
    if (adapter !== "adapter://deterministic/composer-v1")
      throw Error("BLK-EVAL-MODEL-BINDING");
    provider = "deterministic";
    modelId = adapter;
  }
  const parsed = evaluationModelBindingSchema.safeParse({
    resourceId: resource.resourceId,
    provider,
    modelId,
    version: `configuration-${(await digest(resource as unknown as Json)).slice(0, 16)}`,
  });
  if (!parsed.success) throw Error("BLK-EVAL-MODEL-BINDING");
  return parsed.data;
}
