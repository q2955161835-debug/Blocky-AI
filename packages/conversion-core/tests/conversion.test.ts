import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import { projectDigest } from "../../project-model/src";
import { conversionCandidate, lockedSnapshot, validateSnapshot } from "../src";
it("maps verified local source to a reviewable candidate without changing the project", async () => {
  const project = createStarter(),
    before = await projectDigest(project);
  const candidate = await conversionCandidate(
    project,
    "research-agent",
    "product-handbook",
  );
  expect(candidate.source.commit).toBe(
    "d72ed6cb37abebaefda8da39e3e7a5d8fffb2065",
  );
  expect(candidate.evidence[0].lineStart).toBeGreaterThan(0);
  expect(candidate.patch.operations[0]).toMatchObject({
    op: "block.add",
    payload: { type: "core.knowledge.retrieve" },
  });
  expect(candidate.retained.length).toBeGreaterThan(0);
  expect(await projectDigest(project)).toBe(before);
  const tampered = structuredClone(lockedSnapshot);
  tampered.files[0].content += "changed";
  await expect(validateSnapshot(tampered)).rejects.toThrow("BLK-CONVERT-001");
  const abort = new AbortController();
  abort.abort();
  await expect(
    conversionCandidate(
      project,
      "research-agent",
      "product-handbook",
      abort.signal,
    ),
  ).rejects.toThrow();
});
