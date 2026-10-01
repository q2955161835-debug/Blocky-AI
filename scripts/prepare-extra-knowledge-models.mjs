import { readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureAsset, verifyAsset } from "./prepare-knowledge-model.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const extraKnowledgeModels = JSON.parse(
  await readFile(join(root, "vendor/models/extra-models.json"), "utf8"),
);
const native = JSON.parse(
  await readFile(
    join(root, "apps/studio-host/src/knowledge/models.json"),
    "utf8",
  ),
);
for (const model of native) {
  const registry = extraKnowledgeModels.models.find((m) => m.id === model.id);
  if (
    !registry ||
    registry.revision !== model.revision ||
    model.files.some(
      (f) =>
        !registry.files.some(
          (a) =>
            a.name === f.name && a.bytes === f.bytes && a.sha256 === f.sha256,
        ),
    )
  )
    throw Error("Knowledge model manifest mismatch");
}
export async function prepareExtraKnowledgeModels() {
  const results = [];
  for (const model of extraKnowledgeModels.models)
    for (const asset of model.files)
      results.push({
        modelId: model.id,
        name: asset.name,
        status: await ensureAsset(
          join(
            root,
            "try/agent-capability-upgrade/knowledge-models",
            model.directory,
            asset.name,
          ),
          asset,
        ),
      });
  for (const license of extraKnowledgeModels.licenses)
    await verifyAsset(join(root, "vendor/models", license.file), license);
  return results;
}
export async function installExtraKnowledgeModels(target) {
  const { safeDirectory } = await import("./build-document-parser.mjs");
  const absolute = await safeDirectory(target);
  await prepareExtraKnowledgeModels();
  const { installModelAssets } = await import("./install-knowledge-models.mjs");
  await installModelAssets(absolute, extraKnowledgeModels.models, join(root, "try/agent-capability-upgrade/knowledge-models"));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2]) {
    await installExtraKnowledgeModels(process.argv[2]);
    console.log("Locked additional knowledge models installed.");
  } else console.log(JSON.stringify(await prepareExtraKnowledgeModels()));
}
