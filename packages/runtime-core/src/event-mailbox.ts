import { stableId, type Json } from "@blocky/language-schema";
import { utf8 } from "./budget";

type Message = { payload: Json };
type Pending = { key: string; wake(): void };

/** Session-local messages. No implicit external trigger or durable delivery claim. */
export class EventMailbox {
  private messages: { key: string; message: Message; bytes: number }[] = [];
  private pending = new Set<Pending>();
  private bytes = 0;

  private key(projectId: string, channel: string) {
    if (![projectId, channel].every(id => typeof id === "string" && id.length <= 128 && stableId.test(id)))
      throw Error("BLK-EVENT-001");
    return JSON.stringify([projectId, channel]);
  }
  send(projectId: string, channel: string, payload: Json, signal: AbortSignal) {
    signal.throwIfAborted();
    const key = this.key(projectId, channel), encoded = JSON.stringify(payload);
    if (typeof encoded !== "string") throw Error("BLK-EVENT-001");
    const bytes = utf8(encoded);
    if (bytes > 16000 || this.messages.length >= 128 || this.bytes + bytes > 262144)
      throw Error("BLK-EVENT-002");
    this.messages.push({ key, message: { payload: structuredClone(payload) }, bytes });
    this.bytes += bytes;
    // One delivery wakes one receiver, preserving FIFO ordering.
    [...this.pending].find(waiter => waiter.key === key)?.wake();
  }
  async receive(projectId: string, channel: string, timeoutMs: number, signal: AbortSignal): Promise<Message | null> {
    signal.throwIfAborted();
    const key = this.key(projectId, channel);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000)
      throw Error("BLK-EVENT-001");
    const take = () => {
      signal.throwIfAborted();
      const index = this.messages.findIndex(item => item.key === key);
      if (index < 0) return null;
      const [item] = this.messages.splice(index, 1);
      this.bytes -= item.bytes;
      return item.message;
    };
    const immediate = take();
    if (immediate || !timeoutMs) return immediate;
    if (this.pending.size >= 32) throw Error("BLK-EVENT-002");
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        this.pending.delete(waiter);
      };
      const cancel = () => { cleanup(); reject(signal.reason ?? Error("BLK-RUN-005")); };
      const waiter: Pending = { key, wake: () => {
        try {
          const message = take();
          if (message) { cleanup(); resolve(message); }
        } catch (error) { cleanup(); reject(error); }
      } };
      const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
      this.pending.add(waiter);
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
}
