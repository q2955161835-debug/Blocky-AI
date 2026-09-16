import { expect, it } from "vitest";
import { intersecting, toggleSelection } from "../src/selection/selection";
it("toggles membership without duplicates and selects intersecting top-level bounds", () => {
  expect(toggleSelection(["one", "two"], "one")).toEqual(["two"]);
  expect(toggleSelection(["one"], "two")).toEqual(["one", "two"]);
  expect(intersecting({ left: 10, top: 10, right: 30, bottom: 30 }, [
    { id: "one", rect: { left: 0, top: 0, right: 15, bottom: 15 } },
    { id: "two", rect: { left: 31, top: 0, right: 40, bottom: 40 } },
  ])).toEqual(["one"]);
});
