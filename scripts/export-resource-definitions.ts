import { writeFile } from "node:fs/promises";
import { resourceDefinitions } from "../packages/resource-registry/src/definitions";
await writeFile(new URL("../packages/resource-registry/src/definitions.host.json",import.meta.url),JSON.stringify(resourceDefinitions,null,2)+"\n");
