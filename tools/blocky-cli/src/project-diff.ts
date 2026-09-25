export type Change = {
  path: string;
  operation: "add" | "remove" | "replace";
  before: unknown;
  after: unknown;
};
export function projectChanges(before: unknown, after: unknown) {
  const changes: Change[] = [];
  let visited = 0;
  function visit(
    a: unknown,
    b: unknown,
    path: string,
    hasA = true,
    hasB = true,
    depth = 0,
  ) {
    if (++visited > 100000 || depth > 100) throw Error("BLK-CLI-DIFF-LIMIT");
    if (Object.is(a, b)) return;
    if (
      hasA &&
      hasB &&
      a !== null &&
      b !== null &&
      typeof a === "object" &&
      typeof b === "object" &&
      Array.isArray(a) === Array.isArray(b)
    ) {
      const left = a as Record<string, unknown>,
        right = b as Record<string, unknown>;
      for (const key of [
        ...new Set([...Object.keys(left), ...Object.keys(right)]),
      ].sort())
        visit(
          left[key],
          right[key],
          `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
          Object.hasOwn(left, key),
          Object.hasOwn(right, key),
          depth + 1,
        );
    } else
      changes.push({
        path,
        operation: !hasA ? "add" : !hasB ? "remove" : "replace",
        before: hasA ? a : null,
        after: hasB ? b : null,
      });
  }
  visit(before, after, "");
  return changes;
}
