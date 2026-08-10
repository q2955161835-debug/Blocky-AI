import { createHash } from "node:crypto";
import { browser, expect } from "@wdio/globals";
import "@wdio/tauri-service";

interface SoakPreparation {
  readonly baselineSnapshotJson: string;
  readonly baselineSha256: string;
  readonly blockCount: number;
}

interface SoakCycleResult {
  readonly cycle: number;
  readonly blockCount: number;
  readonly nodeCount: number;
  readonly snapshotJson: string;
  readonly snapshotSha256: string;
  readonly compileErrorCount: number;
  readonly terminalTypes: readonly string[];
  readonly eventRowCount: number;
  readonly uncaughtErrors: readonly string[];
  readonly unhandledRejections: readonly string[];
  readonly outboundAttempts: readonly string[];
  readonly jsonRoundTripValid: boolean;
}

interface SoakHookWindow {
  __BLOCKY_SPIKE_TEST__: {
    prepareSoak(): Promise<SoakPreparation>;
    runSoakCycle(cycle: number): Promise<SoakCycleResult>;
    readUsedJsHeapSize(): number | null;
  };
}

interface NativeProjectRecord {
  readonly projectId: string;
  readonly json: string;
  readonly sha256: string;
  readonly bytes: number;
}

const CYCLES = 360;
const TARGET_INTERVAL_MS = 5_000;
const MAX_HEAP_DELTA_BYTES = 32 * 1024 * 1024;
const PROJECT_ID = "windows-core-soak";

function expectedRecord(json: string): NativeProjectRecord {
  return {
    projectId: PROJECT_ID,
    json,
    sha256: createHash("sha256").update(json, "utf8").digest("hex"),
    bytes: Buffer.byteLength(json, "utf8"),
  };
}

async function saveAndReloadThroughRust(
  json: string,
): Promise<NativeProjectRecord> {
  return browser.tauri.execute(async ({ core }, projectId, snapshotJson) => {
    const saved = await core.invoke("save_project", {
      request: { projectId, json: snapshotJson },
    }) as NativeProjectRecord;
    const loaded = await core.invoke("load_project", { projectId }) as NativeProjectRecord;
    if (JSON.stringify(saved) !== JSON.stringify(loaded)) {
      throw new Error("SOAK_RUST_ROUND_TRIP_MISMATCH");
    }
    return loaded;
  }, PROJECT_ID, json);
}

async function readHeap(): Promise<number | null> {
  return browser.tauri.execute(({ core: _core }) =>
    (window as unknown as SoakHookWindow)
      .__BLOCKY_SPIKE_TEST__.readUsedJsHeapSize(),
  );
}

describe("Windows Core 30-minute native soak", function () {
  this.timeout(33 * 60 * 1_000);

  it("completes 360 five-second cycles with Rust and heap evidence", async () => {
    const startedAt = Date.now();
    const preparation = await browser.tauri.execute(({ core: _core }) =>
      (window as unknown as SoakHookWindow).__BLOCKY_SPIKE_TEST__.prepareSoak(),
    );
    expect(preparation.blockCount).toBe(100);
    expect(preparation.baselineSha256).toBe(
      createHash("sha256")
        .update(preparation.baselineSnapshotJson, "utf8")
        .digest("hex"),
    );

    let cyclesCompleted = 0;
    let saveReloadsCompleted = 0;
    let warmHeapBytes: number | null = null;
    let finalHeapBytes: number | null = null;

    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      const cycleStartedAt = Date.now();
      const result = await browser.tauri.execute(({ core: _core }, nextCycle) =>
        (window as unknown as SoakHookWindow)
          .__BLOCKY_SPIKE_TEST__.runSoakCycle(nextCycle), cycle,
      );

      expect(result.cycle).toBe(cycle);
      expect(result.blockCount).toBe(100);
      expect(result.nodeCount).toBe(100);
      expect(result.compileErrorCount).toBe(0);
      expect(result.terminalTypes).toEqual(["run.completed"]);
      expect(result.eventRowCount).toBeLessThanOrEqual(200);
      expect(result.uncaughtErrors).toEqual([]);
      expect(result.unhandledRejections).toEqual([]);
      expect(result.outboundAttempts).toEqual([]);
      expect(result.jsonRoundTripValid).toBe(true);
      expect(result.snapshotSha256).toBe(
        createHash("sha256").update(result.snapshotJson, "utf8").digest("hex"),
      );
      if (cycle % 2 === 0) {
        expect(result.snapshotSha256).toBe(preparation.baselineSha256);
      } else {
        expect(result.snapshotSha256).not.toBe(preparation.baselineSha256);
      }

      if (cycle % 12 === 0) {
        expect(await saveAndReloadThroughRust(result.snapshotJson)).toEqual(
          expectedRecord(result.snapshotJson),
        );
        saveReloadsCompleted += 1;
      }

      cyclesCompleted += 1;
      if (cycle === 60) {
        expect(result.eventRowCount).toBe(200);
        await browser.pause(2_000);
        warmHeapBytes = await readHeap();
        expect(warmHeapBytes).not.toBeNull();
      }
      if (cycle === CYCLES) {
        finalHeapBytes = await readHeap();
        expect(finalHeapBytes).not.toBeNull();
      }

      const remainingMs = TARGET_INTERVAL_MS - (Date.now() - cycleStartedAt);
      if (remainingMs > 0) await browser.pause(remainingMs);

      if (cycle % 12 === 0) {
        console.log(`BLOCKY_SOAK_PROGRESS ${JSON.stringify({
          timestamp: new Date().toISOString(),
          cycle,
          elapsedMs: Date.now() - startedAt,
          saveReloadsCompleted,
          warmHeapBytes,
        })}`);
      }
    }

    const elapsedMs = Date.now() - startedAt;
    expect(cyclesCompleted).toBe(360);
    expect(saveReloadsCompleted).toBe(30);
    expect(elapsedMs).toBeGreaterThanOrEqual(30 * 60 * 1_000);
    expect(warmHeapBytes).not.toBeNull();
    expect(finalHeapBytes).not.toBeNull();
    expect((finalHeapBytes as number) - (warmHeapBytes as number))
      .toBeLessThanOrEqual(MAX_HEAP_DELTA_BYTES);

    console.log(`BLOCKY_SOAK_FINAL ${JSON.stringify({
      timestamp: new Date().toISOString(),
      cyclesCompleted,
      elapsedMs,
      saveReloadsCompleted,
      warmHeapBytes,
      finalHeapBytes,
      heapDeltaBytes: (finalHeapBytes as number) - (warmHeapBytes as number),
    })}`);
  });
});
