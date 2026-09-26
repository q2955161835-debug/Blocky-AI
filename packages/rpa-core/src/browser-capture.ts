import { randomUUID } from "node:crypto";
/** A one-use, sequential transfer; PNG bytes never enter the general event stream. */
export class BrowserCapture {
  readonly captureId = `capture-${randomUUID()}`;
  private offset = 0;
  constructor(readonly stepId: string, private bytes: Uint8Array, readonly maskedRegions: number) {
    if (!bytes.length || bytes.length > 4194304 || !Number.isInteger(maskedRegions) || maskedRegions < 0 || maskedRegions > 2048) {
      this.clear(); throw Error("BLK-RPA-CAPTURE-003");
    }
  }
  metadata() { return { captureId: this.captureId, bytes: this.bytes.length, maskedRegions: this.maskedRegions }; }
  read(captureId: string, stepId: string, offset: number) {
    if (!this.bytes.length || captureId !== this.captureId || stepId !== this.stepId || offset !== this.offset) throw Error("BLK-RPA-CAPTURE-002");
    const end = Math.min(offset + 32768, this.bytes.length);
    const result = { offset, data: Buffer.from(this.bytes.buffer, this.bytes.byteOffset + offset, end - offset).toString("base64"), done: end === this.bytes.length };
    this.offset = end;
    if (result.done) this.clear();
    return result;
  }
  clear() { this.bytes.fill(0); this.bytes = Buffer.alloc(0); }
}
