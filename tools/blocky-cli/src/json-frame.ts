/** JSON envelopes contain bounded records in large arrays. Serialize each array
 * record separately instead of allocating a second full index plus pipe buffer. */
export function* jsonFrame(value: Record<string, unknown>): Generator<string> {
  function* parts(item: unknown): Generator<string> {
    if (Array.isArray(item)) {
      yield "[";
      for (let n = 0; n < item.length; n++) {
        if (n) yield ",";
        yield JSON.stringify(item[n]) ?? "null";
      }
      yield "]";
    } else if (item !== null && typeof item === "object") {
      yield "{";
      let first = true;
      for (const [key, field] of Object.entries(item)) {
        if (field === undefined) continue;
        if (!first) yield ",";
        first = false;
        yield JSON.stringify(key) + ":";
        yield* parts(field);
      }
      yield "}";
    } else {
      const encoded = JSON.stringify(item);
      if (encoded === undefined) throw Error("Invalid JSON field");
      yield encoded;
    }
  }
  let batch = "";
  for (const part of parts(value)) {
    batch += part;
    if (batch.length >= 64 * 1024) {
      yield batch;
      batch = "";
    }
  }
  yield batch + "\n";
}
