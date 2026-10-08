/** Read import and delay-import DLL names from PE32/PE32+ headers, not string guesses. */
export function peImports(bytes) {
  const need = (offset, count) => { if (!Number.isSafeInteger(offset) || offset < 0 || offset + count > bytes.length) throw Error("Invalid PE boundary"); };
  need(0, 64);
  if (bytes.toString("ascii", 0, 2) !== "MZ") throw Error("Not a PE image");
  const pe = bytes.readUInt32LE(60);
  need(pe, 24);
  if (bytes.readUInt32LE(pe) !== 0x4550) throw Error("Invalid PE signature");
  const count = bytes.readUInt16LE(pe + 6), optionalSize = bytes.readUInt16LE(pe + 20), optional = pe + 24;
  need(optional, optionalSize + count * 40);
  const magic = bytes.readUInt16LE(optional);
  if (![0x10b, 0x20b].includes(magic)) throw Error("Unsupported PE image");
  const directories = optional + (magic === 0x20b ? 112 : 96);
  const directoryCount = bytes.readUInt32LE(directories - 4);
  const imageBase = magic === 0x20b ? bytes.readBigUInt64LE(optional + 24) : BigInt(bytes.readUInt32LE(optional + 28));
  const rvaOffset = rva => {
    for (let index = 0; index < count; index++) {
      const section = optional + optionalSize + index * 40;
      const va = bytes.readUInt32LE(section + 12), size = bytes.readUInt32LE(section + 16), raw = bytes.readUInt32LE(section + 20);
      if (rva >= va && rva - va < size) { const offset = raw + rva - va; need(offset, 1); return offset; }
    }
    throw Error("Unmapped PE RVA");
  };
  const dll = rva => {
    const start = rvaOffset(rva), end = bytes.indexOf(0, start);
    if (end < 0 || end - start > 512) throw Error("Invalid PE import name");
    const name = bytes.toString("ascii", start, end).toLowerCase();
    if (!/^[a-z0-9_.-]+\.dll$/.test(name)) throw Error("Invalid PE DLL name");
    return name;
  };
  const imports = new Set();
  for (const [index, width, nameOffset] of [[1, 20, 12], [13, 32, 4]]) {
    if (directoryCount <= index || directories + (index + 1) * 8 > optional + optionalSize) continue;
    const address = bytes.readUInt32LE(directories + index * 8), size = bytes.readUInt32LE(directories + index * 8 + 4);
    if (!address) continue;
    const start = rvaOffset(address);
    let terminated = false;
    for (let offset = start; offset < start + size; offset += width) {
      need(offset, width);
      if (bytes.subarray(offset, offset + width).every(value => value === 0)) { terminated = true; break; }
      let name = bytes.readUInt32LE(offset + nameOffset);
      if (index === 13 && !(bytes.readUInt32LE(offset) & 1)) name = Number(BigInt(name) - imageBase);
      imports.add(dll(name));
    }
    if (!terminated) throw Error("Unterminated PE import table");
  }
  return [...imports].sort();
}
