import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ResizeHandle } from "./ResizeHandle";
import "./ChatLayout.css";

const COLLAPSED_HEIGHT = 39;
const DEFAULT_EXPANDED_HEIGHT = 200;
const MIN_EXPANDED_HEIGHT = 120;
const LIBRARY_CHROME_HEIGHT = 84;
const PALETTE_MIN_HEIGHT = 120;

export function BlueprintDock({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [libraryHeight, setLibraryHeight] = useState(0);
  const [requestedHeight, setRequestedHeight] = useState(
    DEFAULT_EXPANDED_HEIGHT,
  );
  const dockRef = useRef<HTMLElement>(null);
  const contentId = `blueprint-dock-${useId().replaceAll(":", "")}`;

  useLayoutEffect(() => {
    const library = dockRef.current?.closest<HTMLElement>(".library");
    if (!library) return;

    const measure = () => {
      const nextHeight =
        library.getBoundingClientRect().height ||
        library.clientHeight ||
        window.innerHeight;
      setLibraryHeight((current) =>
        current === nextHeight ? current : nextHeight,
      );
    };

    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(library);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const availableHeight = libraryHeight || window.innerHeight;
  const reservedPaletteHeight = Math.min(
    PALETTE_MIN_HEIGHT,
    Math.max(40, Math.floor(availableHeight * 0.25)),
  );
  const availableDockHeight = Math.max(
    COLLAPSED_HEIGHT,
    availableHeight - LIBRARY_CHROME_HEIGHT - reservedPaletteHeight,
  );
  const maxExpandedHeight = Math.max(
    COLLAPSED_HEIGHT,
    Math.floor(Math.min(availableHeight * 0.7, availableDockHeight)),
  );
  const minExpandedHeight = Math.min(MIN_EXPANDED_HEIGHT, maxExpandedHeight);
  const expandedHeight = Math.min(
    maxExpandedHeight,
    Math.max(minExpandedHeight, requestedHeight),
  );

  return (
    <section
      ref={dockRef}
      className="blueprint-dock"
      style={{
        height: `${expanded ? expandedHeight : COLLAPSED_HEIGHT}px`,
        maxHeight: `${expanded ? maxExpandedHeight : COLLAPSED_HEIGHT}px`,
      }}
    >
      {expanded && (
        <ResizeHandle
          className="blueprint-dock-resize"
          label="调整蓝图栏高度"
          axis="y"
          value={expandedHeight}
          min={minExpandedHeight}
          max={maxExpandedHeight}
          reverse
          onChange={setRequestedHeight}
        />
      )}
      <button
        type="button"
        className="blueprint-dock-toggle"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((open) => !open)}
      >
        <span>蓝图</span>
        <span className="blueprint-dock-chevron" aria-hidden="true">
          ⌃
        </span>
      </button>
      <div id={contentId} className="blueprint-dock-content" hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
