export type CanvasPointerMode = "default" | "pan";
type Viewport = { scrollX: number; scrollY: number; scroll(x: number, y: number): void };
type Options = { mode(): CanvasPointerMode; space(): boolean; changed(active: boolean): void };

/** Claims panning before Blockly fields, block dragging and our selection gestures. */
export function installCanvasPanning(element: HTMLElement, viewport: Viewport, options: Options) {
  let gesture: { x: number; y: number; sx: number; sy: number; pointer: number } | undefined;
  const isControl = (target: EventTarget | null) => target instanceof Element && !!target.closest("[data-canvas-controls]");
  const suppress = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const cancel = () => {
    if (!gesture) return;
    const pointer = gesture.pointer;
    gesture = undefined;
    if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
    options.changed(false);
  };
  const down = (event: PointerEvent) => {
    if (isControl(event.target)) return;
    const isInput = event.target instanceof HTMLElement &&
      (event.target.matches("input,textarea,select") || event.target.isContentEditable);
    if (!isInput) element.focus({ preventScroll: true });
    const shouldPan = event.button === 1 || (event.button === 0 && (options.mode() === "pan" || options.space()));
    if (!shouldPan) return;
    suppress(event);
    if (gesture) return;
    gesture = { x: event.clientX, y: event.clientY, sx: viewport.scrollX, sy: viewport.scrollY, pointer: event.pointerId };
    element.setPointerCapture(event.pointerId);
    options.changed(true);
  };
  const move = (event: PointerEvent) => {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    suppress(event);
    viewport.scroll(gesture.sx + event.clientX - gesture.x, gesture.sy + event.clientY - gesture.y);
  };
  const up = (event: PointerEvent) => {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    suppress(event); cancel();
  };
  const lost = (event: PointerEvent) => { if (gesture?.pointer === event.pointerId) cancel(); };
  // WebView/Blockly can also dispatch mouse events after a pointer gesture.
  const mouse = (event: MouseEvent) => {
    if (options.mode() === "pan" && event.button === 0 && !isControl(event.target)) suppress(event);
  };
  element.addEventListener("pointerdown", down, true);
  element.addEventListener("pointermove", move, true);
  element.addEventListener("pointerup", up, true);
  element.addEventListener("pointercancel", up, true);
  element.addEventListener("lostpointercapture", lost, true);
  for (const type of ["mousedown", "mouseup", "click", "dblclick"] as const) element.addEventListener(type, mouse, true);
  window.addEventListener("blur", cancel);
  return { cancel, dispose() {
    cancel();
    element.removeEventListener("pointerdown", down, true);
    element.removeEventListener("pointermove", move, true);
    element.removeEventListener("pointerup", up, true);
    element.removeEventListener("pointercancel", up, true);
    element.removeEventListener("lostpointercapture", lost, true);
    for (const type of ["mousedown", "mouseup", "click", "dblclick"] as const) element.removeEventListener(type, mouse, true);
    window.removeEventListener("blur", cancel);
  } };
}
