import { useRef, useState } from "react";

/** A boundary splitter: capture stays on the handle until release or cancellation. */
export function ResizeHandle({
  label,
  axis,
  value,
  min,
  max,
  reverse = false,
  onChange,
  className = "",
}: {
  label: string;
  axis: "x" | "y";
  value: number;
  min: number;
  max: number;
  reverse?: boolean;
  onChange(value: number): void;
  className?: string;
}) {
  const drag = useRef<{ position: number; value: number; id: number } | null>(
    null,
  );
  const [active, setActive] = useState(false);
  const clamp = (next: number) =>
    Math.round(Math.max(min, Math.min(Math.max(min, max), next)));
  const direction = reverse ? -1 : 1;
  const finish = () => {
    drag.current = null;
    setActive(false);
  };
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, max)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      className={`resize-handle resize-${axis} ${active ? "resizing" : ""} ${className}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = {
          position: axis === "x" ? event.clientX : event.clientY,
          value,
          id: event.pointerId,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setActive(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        onChange(
          clamp(
            start.value +
              ((axis === "x" ? event.clientX : event.clientY) -
                start.position) *
                direction,
          ),
        );
      }}
      onPointerUp={(event) => {
        if (drag.current?.id === event.pointerId) {
          finish();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={(event) => {
        const lower = axis === "x" ? "ArrowLeft" : "ArrowUp",
          upper = axis === "x" ? "ArrowRight" : "ArrowDown";
        if (![lower, upper, "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        onChange(
          clamp(
            event.key === "Home"
              ? min
              : event.key === "End"
                ? max
                : value +
                  (event.key === upper ? 1 : -1) *
                    direction *
                    (event.shiftKey ? 50 : 10),
          ),
        );
      }}
    />
  );
}
