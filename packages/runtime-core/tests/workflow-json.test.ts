import { expect, it } from "vitest";
import { workflowJson } from "../src/workflow/protocol";

it("keeps default workflow depth, node and byte limits", () => {
  let value: unknown = 0;
  for (let index = 0; index < 32; index++) value = [value];
  expect(workflowJson(value)).toEqual(value);
  expect(() => workflowJson([value])).toThrow("BLK-WORKFLOW-LIMIT");
  expect(() => workflowJson(Array(50000).fill(null), 300000)).toThrow(
    "BLK-WORKFLOW-LIMIT",
  );
  expect(() => workflowJson("中".repeat(50), 100)).toThrow(
    "BLK-WORKFLOW-LIMIT",
  );
});

it("clones JSON without invoking inherited array serialization and preserves escaping and aliases", () => {
  let invoked = false;
  class CustomArray extends Array {
    get toJSON() {
      invoked = true;
      return () => [];
    }
  }
  expect(() => workflowJson(new CustomArray())).toThrow("BLK-WORKFLOW-INVALID");
  expect(invoked).toBe(false);
  const shared = { text: '中\n"\\\u0000', number: -0 };
  const value = JSON.parse('{"__proto__":{"x":1}}');
  value.items = [shared, shared, null, true, 1.5];
  const cloned = workflowJson(value);
  expect(JSON.stringify(cloned)).toBe(JSON.stringify(value));
  expect(cloned).not.toBe(value);
  expect(() =>
    workflowJson({
      get value() {
        invoked = true;
        return 1;
      },
    }),
  ).toThrow();
  expect(invoked).toBe(false);
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  expect(() => workflowJson(cyclic)).toThrow("BLK-WORKFLOW-INVALID");
});
