import { expect,it } from "vitest";
import { readFileSync } from "node:fs";
import { resourceDefinitions } from "../src";
it("keeps native rollback field validation aligned with the editor contract",()=>{
  expect(JSON.parse(readFileSync(new URL("../src/definitions.host.json",import.meta.url),"utf8"))).toEqual(resourceDefinitions);
});
