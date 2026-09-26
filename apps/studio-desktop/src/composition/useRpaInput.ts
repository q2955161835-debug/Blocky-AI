import { useCallback, useEffect, useRef, useState } from "react";
import type { RpaModulePorts } from "@blocky/rpa-core";
export function useRpaInput() {
  const [source, setSource] = useState<{ moduleId: string; blockId: string }>();
  const pending = useRef<
    { finish: (value: string | null) => void } | undefined
  >(undefined);
  const answer = useCallback(
    (value: string | null) => pending.current?.finish(value),
    [],
  );
  const request = useCallback<NonNullable<RpaModulePorts["manualInput"]>>(
    (source, signal) => {
      signal.throwIfAborted();
      if (pending.current) return Promise.reject(Error("BLK-RPA-STATE-001"));
      return new Promise((resolve, reject) => {
        const cancel = () => finish(null);
        const finish = (value: string | null) => {
          if (!pending.current) return;
          pending.current = undefined;
          signal.removeEventListener("abort", cancel);
          setSource(undefined);
          if (value === null) reject(Error("BLK-RPA-CANCELLED"));
          else resolve(value);
        };
        pending.current = { finish };
        setSource(source);
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
      });
    },
    [],
  );
  useEffect(
    () => () => {
      pending.current?.finish(null);
    },
    [],
  );
  return { source, request, answer };
}
