import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { SpikeBlockId } from "./catalog";
import { getDefinition } from "./definitions";
import { BlockPreview } from "./BlockPreview";
import {
  SPIKE_BLOCK_CATEGORIES,
  type SpikeBlockCategoryId,
} from "./toolbox";

export interface BlockInsertRequest {
  readonly blockType: SpikeBlockId;
  readonly clientPoint?: Readonly<{ clientX: number; clientY: number }>;
}

export interface BlockPointerDragStart {
  readonly blockType: SpikeBlockId;
  readonly pointerId: number;
  readonly clientPoint: Readonly<{ clientX: number; clientY: number }>;
}

export interface BlockLibraryProps {
  readonly selectedCategoryId: SpikeBlockCategoryId;
  readonly onSelectedCategoryIdChange: (categoryId: SpikeBlockCategoryId) => void;
  readonly onInsert: (request: BlockInsertRequest) => void;
  readonly onPointerDragStart?: (request: BlockPointerDragStart) => void;
}

export function getBlockDisplayName(blockType: SpikeBlockId): string {
  const message = getDefinition(blockType).json.message0;
  return typeof message === "string"
    ? message.replace(/%\d+/g, " ").replace(/\s+/g, " ").trim()
    : blockType;
}

export function BlockLibrary({
  selectedCategoryId,
  onSelectedCategoryIdChange,
  onInsert,
  onPointerDragStart,
}: BlockLibraryProps) {
  const [query, setQuery] = useState("");
  const pointerSessionRef = useRef<{
    readonly pointerId: number;
    readonly startX: number;
    readonly startY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const selectedCategory = SPIKE_BLOCK_CATEGORIES.find(
    (category) => category.id === selectedCategoryId,
  ) ?? SPIKE_BLOCK_CATEGORIES[0];
  const visibleBlocks = useMemo(() => {
    const candidates = normalizedQuery
      ? SPIKE_BLOCK_CATEGORIES.flatMap((category) => category.blockIds)
      : selectedCategory.blockIds;
    return candidates.filter((blockType) =>
      getBlockDisplayName(blockType)
        .toLocaleLowerCase("zh-CN")
        .includes(normalizedQuery),
    );
  }, [normalizedQuery, selectedCategory.blockIds]);

  const startPointerDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    blockType: SpikeBlockId,
  ): void => {
    if (event.button !== 0) return;
    pointerSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    onPointerDragStart?.({
      blockType,
      pointerId: event.pointerId,
      clientPoint: { clientX: event.clientX, clientY: event.clientY },
    });
  };

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const session = pointerSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (
        Math.hypot(event.clientX - session.startX, event.clientY - session.startY) >= 6
      ) {
        session.moved = true;
      }
    };
    const finish = (event: PointerEvent): void => {
      const session = pointerSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      suppressClickRef.current = session.moved;
      pointerSessionRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, []);

  return (
    <aside className="block-library" aria-label="积木库">
      <nav className="block-category-rail" aria-label="积木分类">
        <strong>积木库</strong>
        {SPIKE_BLOCK_CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            aria-pressed={category.id === selectedCategory.id}
            style={{ "--category-colour": category.colour } as CSSProperties}
            onClick={() => onSelectedCategoryIdChange(category.id)}
          >
            {category.name}
          </button>
        ))}
      </nav>
      <section className="block-palette" aria-label="当前分类积木">
        <header>
          <strong>{normalizedQuery ? "搜索结果" : selectedCategory.name}</strong>
          <span>{visibleBlocks.length} 个</span>
        </header>
        <input
          type="search"
          aria-label="搜索全部积木"
          placeholder="搜索全部积木"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <div className="block-palette__list">
          {visibleBlocks.map((blockType) => {
            const displayName = getBlockDisplayName(blockType);
            return (
              <button
                key={blockType}
                type="button"
                className="block-library__item"
                aria-label={displayName}
                onClick={(event) => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    event.preventDefault();
                    return;
                  }
                  onInsert({ blockType });
                }}
                onPointerDown={(event) => startPointerDrag(event, blockType)}
              >
                <BlockPreview blockType={blockType} />
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
