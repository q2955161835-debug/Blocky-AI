import { BrowserPipe } from "./browser-wire";

const pipe = new BrowserPipe();
let pending = Buffer.alloc(0);
try {
  // Async iteration provides backpressure. The parent sends one bounded request at a time.
  for await (const chunk of process.stdin) {
    pending = Buffer.concat([pending, chunk as Buffer]);
    if (pending.length > 65536) throw Error("BLK-RPA-WIRE-001");
    const newline = pending.indexOf(10);
    if (newline < 0) continue;
    if (newline !== pending.length - 1) throw Error("BLK-RPA-WIRE-001");
    const reply = await pipe.receive(pending.subarray(0, newline));
    pending.fill(0); pending = Buffer.alloc(0);
    const text = JSON.stringify(reply) + "\n";
    if (Buffer.byteLength(text) > 65536) throw Error("BLK-RPA-LIMIT-001");
    await new Promise<void>((resolve, reject) => process.stdout.write(text, (error) => error ? reject(error) : resolve()));
  }
  if (pending.length) throw Error("BLK-RPA-WIRE-001");
} catch { process.exitCode = 1; }
finally { pending.fill(0); await pipe.shutdown().catch(() => { process.exitCode = 1; }); }
