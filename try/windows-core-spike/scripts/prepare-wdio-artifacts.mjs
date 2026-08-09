import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const workspace = resolve(process.cwd());
const artifactParent = resolve(workspace, "artifacts");
const artifactDirectory = resolve(artifactParent, "wdio");

if (dirname(artifactDirectory) !== artifactParent) {
  throw new Error("WDIO_ARTIFACT_PATH_OUTSIDE_EXPECTED_PARENT");
}

rmSync(artifactDirectory, { force: true, recursive: true, maxRetries: 3 });
mkdirSync(artifactDirectory, { recursive: true });
