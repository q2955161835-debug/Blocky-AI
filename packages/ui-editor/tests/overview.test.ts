import { expect, it } from "vitest";
import { overviewBounds, overviewLabels } from "../src/canvas/overview";

it("includes offscreen and negative block extents without changing canvas geometry", () => {
  const blocks = [{ x: -900, y: -300, width: 100, height: 200 }, { x: 2500, y: 1400, width: 300, height: 80 }];
  const viewport = { x: 20, y: 40, width: 700, height: 500 };
  const original = JSON.stringify({ blocks, viewport });
  const bounds = overviewBounds(blocks, viewport);
  expect(bounds.x).toBeLessThan(-900); expect(bounds.y).toBeLessThan(-300);
  expect(bounds.x + bounds.width).toBeGreaterThan(2800);
  expect(bounds.y + bounds.height).toBeGreaterThan(1480);
  expect(JSON.stringify({ blocks, viewport })).toBe(original);
  expect(overviewBounds([{ x: NaN, y: 1, width: 10, height: 10 }], viewport)).toEqual(overviewBounds([], viewport));
});
it("reads bounded group and note labels and tolerates malformed metadata", () => {
  expect(overviewLabels('{"schemaVersion":"blocky.editor/v1","group":{"kind":"region","label":"准备"},"note":"检查数据"}'))
    .toEqual({ group: "区域：准备", note: "检查数据" });
  expect(overviewLabels("not json")).toEqual({});
  expect(overviewLabels('{"schemaVersion":"other","note":"hidden"}')).toEqual({});
  expect(overviewLabels(JSON.stringify({ schemaVersion: "blocky.editor/v1", note: "x".repeat(1000) })).note).toHaveLength(300);
});
