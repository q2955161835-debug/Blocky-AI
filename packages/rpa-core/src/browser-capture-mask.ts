import type { Locator, Page } from "playwright-core";
export const CAPTURE_MASK_SELECTOR = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"],[role="spinbutton"],iframe,frame,object,embed';
/** Opacity applies to the entire rendered subtree, including overflowing text.
 * Keep layout and original inline styling; do not read any input text. */
export async function concealCaptureInputs(page: Page, locator: Locator) {
  const elements = await locator.elementHandles();
  let state;
  try {
    if (elements.length > 2048) throw Error("BLK-RPA-CAPTURE-003");
    state = await page.evaluateHandle(({nodes,selector}) => {
      const roots: (Document|ShadowRoot)[] = [document];let visited=0;
      for(let index=0;index<roots.length;index++) {
        const walker=document.createTreeWalker(roots[index],NodeFilter.SHOW_ELEMENT);
        while(walker.nextNode()) {
          if(++visited>20000||roots.length>128)throw Error("BLK-RPA-CAPTURE-003");
          const shadow=(walker.currentNode as Element).shadowRoot;if(shadow)roots.push(shadow);
        }
      }
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
      const containsInput = (node: Node): boolean => {
        if(!(node instanceof Element))return false;
        if(node.matches(selector)||node.querySelector(selector)||saved.some(item=>node===item.node||node.contains(item.node)))return true;
        const walker=document.createTreeWalker(node,NodeFilter.SHOW_ELEMENT);let count=0;
        const shadowInput=(element:Element)=>!!element.shadowRoot?.querySelector(selector);
        if(shadowInput(node))return true;
        while(walker.nextNode()){if(++count>20000)return true;if(shadowInput(walker.currentNode as Element))return true;}
        return false;
      };
      const observe = (records: MutationRecord[]) => {
        for(const record of records) {
          if(record.type==="attributes") {
            if(record.attributeName!=="style")changed=true;
            else if(saved.some(item=>item.node===record.target)&&(!hiddenStyle(record.oldValue??"")||!hiddenStyle((record.target as Element).getAttribute("style")??"")))changed=true;
          }else if(saved.some(item=>item.node===record.target||item.node.contains(record.target))||[...record.addedNodes,...record.removedNodes].some(containsInput))changed=true;
        }
      };
      const observer = new MutationObserver(observe);
      for(const root of roots)observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:["style","role","contenteditable","type"],attributeOldValue:true});
      return {
        valid: (current: Node[]) => {
          observe(observer.takeRecords());
          return !changed && current.length===saved.length && saved.every((item,index) => item.node===current[index] && item.node.isConnected && getComputedStyle(item.node).opacity === "0");
        },
        restore: () => {
          observer.disconnect();
          for (const item of saved) {
            // Preserve independent page changes; a changed style invalidates the image.
            if (item.style.getPropertyValue("opacity") !== "0" || item.style.getPropertyPriority("opacity") !== "important") continue;
            if (item.value) item.style.setProperty("opacity", item.value, item.priority); else item.style.removeProperty("opacity");
          }
        },
      };
    }, {nodes:elements,selector:CAPTURE_MASK_SELECTOR});
  } catch (error) { await Promise.allSettled(elements.map(element => element.dispose())); throw error; }
  const handle = state;
  return {
    valid: async () => {
      const current=await locator.elementHandles();
      try {return current.length===elements.length && await handle.evaluate((value,nodes)=>value.valid(nodes),current);}
      finally {await Promise.allSettled(current.map(element=>element.dispose()));}
    },
    restore: async () => {
      try { await handle.evaluate(value => value.restore()); }
      finally { await handle.dispose(); await Promise.allSettled(elements.map(element => element.dispose())); }
    },
  };
}
