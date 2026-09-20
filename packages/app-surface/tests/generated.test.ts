import { expect, it } from "vitest";
import { createStarter } from "../../test-fixtures/src";
import {
  draftGeneratedSurface,
  validateSurface,
  previewDocument,
} from "../src";
const spec = {
  schemaVersion: "blocky.surface-spec/v1",
  title: "设备报修",
  description: "提交故障描述",
  layout: "split",
  submitLabel: "分析故障",
  resultLabel: "处理建议",
  attachment: true,
  confirmation: true,
  fields: [
    { id: "device", label: "设备", type: "text", required: true, options: [] },
    {
      id: "severity",
      label: "紧急程度",
      type: "select",
      required: true,
      options: ["一般", "紧急"],
    },
  ],
};
it("compiles different task forms into locked, reviewable source without changing the project", async () => {
  const p = createStarter(),
    before = JSON.stringify(p);
  const a = await draftGeneratedSurface(
    p,
    "research-agent",
    "explicit-user-command",
    spec,
  );
  const b = await draftGeneratedSurface(
    p,
    "research-agent",
    "explicit-user-command",
    {
      ...spec,
      title: "学习资料查询",
      layout: "stack",
      fields: [
        {
          id: "question",
          label: "问题",
          type: "textarea",
          required: true,
          options: [],
        },
      ],
    },
  );
  expect(previewDocument(a)).toContain("设备");
  expect(previewDocument(b)).not.toContain("紧急程度");
  expect(previewDocument(a)).not.toEqual(previewDocument(b));
  expect(JSON.stringify(p)).toBe(before);
  expect(validateSurface(p, a)).toEqual(a);
  const tampered = structuredClone(a);
  tampered.files[`${a.manifest.sourceRootRef}/page.js`] =
    'fetch("https://example.com")';
  expect(() => validateSurface(p, tampered)).toThrow("BLK-SURFACE-002");
});
it("escapes source text and rejects implicit pages, unknown fields and dependency injection", async () => {
  const p = createStarter();
  await expect(
    draftGeneratedSurface(p, "research-agent", "agent-request", spec),
  ).rejects.toThrow("BLK-SURFACE-001");
  await expect(
    draftGeneratedSurface(p, "research-agent", "explicit-user-command", {
      ...spec,
      dependencies: { evil: "latest" },
    }),
  ).rejects.toThrow("BLK-SURFACE-002");
  const d = await draftGeneratedSurface(
    p,
    "research-agent",
    "explicit-user-command",
    { ...spec, title: "</template><script>alert(1)</script>" },
  );
  expect(previewDocument(d)).not.toContain("</template><script>alert(1)");
});
