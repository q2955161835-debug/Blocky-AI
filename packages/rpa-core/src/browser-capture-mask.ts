import type { Locator, Page } from "playwright-core";
/** Opacity applies to the entire rendered subtree, including overflowing text.
 * Keep layout and original inline styling; do not read any input text. */
export async function concealCaptureInputs(page: Page, locator: Locator) {
  const elements = await locator.elementHandles();
  let state;
  try {
    if (elements.length > 2048) throw Error("BLK-RPA-CAPTURE-003");
    state = await page.evaluateHandle((nodes) => {
      const saved = nodes.map(node => {
        const style = (node as HTMLElement).style;
        if (!style) throw Error("BLK-RPA-CAPTURE-005");
        return { node: node as Element, style, value: style.getPropertyValue("opacity"), priority: style.getPropertyPriority("opacity") };
      });
      for (const item of saved) item.style.setProperty("opacity", "0", "important");
      let changed = false;
      const probe = document.createElement("span");
      const hiddenStyle = (text: string) => { probe.style.cssText = text; return probe.style.getPropertyValue("opacity") === "0" && probe.style.getPropertyPriority("opacity") === "important"; };
      // Playwright temporarily changes caret-color. Track opacity changes only,
      // including a page changing it away and back within one observer delivery.
      const observer = new MutationObserver(records => {
        if (records.some(record => !hiddenStyle(record.oldValue ?? "") || !hiddenStyle((record.target as Element).getAttribute("style") ?? ""))) changed = true;
      });
      for (const item of saved) observer.observe(item.node, { attributes: true, attributeFilter: ["style"], attributeOldValue: true });
      return {
        valid: () => !changed && saved.every(item => item.node.isConnected && getComputedStyle(item.node).opacity === "0"),
        restore: () => {
          observer.disconnect();
          for (const item of saved) {
            // Preserve independent page changes; a changed style invalidates the image.
            if (item.style.getPropertyValue("opacity") !== "0" || item.style.getPropertyPriority("opacity") !== "important") continue;
            if (item.value) item.style.setProperty("opacity", item.value, item.priority); else item.style.removeProperty("opacity");
          }
        },
      };
    }, elements);
  } catch (error) { await Promise.allSettled(elements.map(element => element.dispose())); throw error; }
  const handle = state;
  return {
    valid: async () => await locator.count() === elements.length && await handle.evaluate(value => value.valid()),
    restore: async () => {
      try { await handle.evaluate(value => value.restore()); }
      finally { await handle.dispose(); await Promise.allSettled(elements.map(element => element.dispose())); }
    },
  };
}
