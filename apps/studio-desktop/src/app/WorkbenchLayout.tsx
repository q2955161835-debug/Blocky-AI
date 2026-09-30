import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Studio } from "../composition/useStudio";
import { ResizeHandle } from "./ResizeHandle";

export function WorkbenchLayout({
  studio: s,
  left,
  right,
  children,
}: {
  studio: Studio;
  left: ReactNode;
  right: ReactNode;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(() => window.innerWidth);
  useEffect(() => {
    if (!root.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailable(entry.contentRect.width),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const { leftVisible, rightVisible, leftWidth, rightWidth } = s.session;
  const leftMin = leftVisible ? 180 : 0,
    rightMin = rightVisible ? 240 : 0;
  const budget = Math.max(leftMin + rightMin, available - 248);
  const desiredLeft = leftVisible ? leftWidth : 0,
    desiredRight = rightVisible ? rightWidth : 0;
  const excess = Math.max(0, desiredLeft + desiredRight - budget);
  const flexible = desiredLeft + desiredRight - leftMin - rightMin;
  const leftSize =
    desiredLeft -
    (flexible > 0 ? (excess * (desiredLeft - leftMin)) / flexible : 0);
  const rightSize =
    desiredRight -
    (flexible > 0 ? (excess * (desiredRight - rightMin)) / flexible : 0);
  return (
    <div
      ref={root}
      className="workbench"
      style={{
        gridTemplateColumns: `${leftSize}px ${leftVisible ? 4 : 0}px minmax(0,1fr) ${rightVisible ? 4 : 0}px ${rightSize}px`,
      }}
    >
      <div className="workbench-left" hidden={!leftVisible}>
        {left}
      </div>
      {leftVisible ? (
        <ResizeHandle
          className="left-boundary"
          label="左侧积木库宽度"
          axis="x"
          value={leftSize}
          min={180}
          max={Math.min(1200, budget - rightSize)}
          onChange={(leftWidth) =>
            s.setSession((current) => ({ ...current, leftWidth }))
          }
        />
      ) : (
        <div className="left-boundary" />
      )}
      {children}
      {rightVisible ? (
        <ResizeHandle
          className="right-boundary"
          label="右侧面板宽度"
          axis="x"
          reverse
          value={rightSize}
          min={240}
          max={Math.min(1200, budget - leftSize)}
          onChange={(rightWidth) =>
            s.setSession((current) => ({ ...current, rightWidth }))
          }
        />
      ) : (
        <div className="right-boundary" />
      )}
      <div className="workbench-right" hidden={!rightVisible}>
        {right}
      </div>
    </div>
  );
}
