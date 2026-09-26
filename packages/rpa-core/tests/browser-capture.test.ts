import { describe, expect, it } from "vitest";
import { BrowserCapture } from "../src/browser-capture";
describe("private image transfer", () => {
  it("binds IDs and ordered chunks, wipes consumed bytes and denies replay", () => {
    const bytes = Buffer.alloc(65537, 173), capture = new BrowserCapture("shot", bytes, 2);
    const { captureId } = capture.metadata();
    expect(() => capture.read(captureId, "wrong", 0)).toThrow("BLK-RPA-CAPTURE-002");
    expect(() => capture.read(captureId, "shot", 32768)).toThrow("BLK-RPA-CAPTURE-002");
    const parts = [capture.read(captureId, "shot", 0), capture.read(captureId, "shot", 32768), capture.read(captureId, "shot", 65536)];
    expect(parts.map(p => p.done)).toEqual([false, false, true]);
    expect(parts.every(p => JSON.stringify(p).length < 65536)).toBe(true);
    expect(Buffer.concat(parts.map(p => Buffer.from(p.data, "base64")))).toEqual(Buffer.alloc(65537, 173));
    expect(bytes.every(byte => byte === 0)).toBe(true);
    expect(() => capture.read(captureId, "shot", 65537)).toThrow("BLK-RPA-CAPTURE-002");
  });
});
