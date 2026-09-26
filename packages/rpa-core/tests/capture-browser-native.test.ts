import { expect, it } from "vitest";
import { chromium } from "playwright-core";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { BrowserRpaAdapter } from "../src";
import { concealCaptureInputs } from "../src/browser-capture-mask";
it.skipIf(process.env.BLOCKY_RPA_CAPTURE_HEADLESS!=="1")("captures real content while masking changing inputs and embedded documents",async()=>{
  const root=resolve("try/stage7/capture-browser-tests");await mkdir(root,{recursive:true});
  const temporary=await mkdtemp(resolve(root,"session-")),oldTemp=process.env.TEMP,oldTmp=process.env.TMP;
  process.env.TEMP=temporary;process.env.TMP=temporary;
  let browser;
  try{
    browser=await chromium.launch({channel:"msedge",headless:true});
    const page=await browser.newPage();
    await page.route("**/*",route=>route.fulfill({contentType:"text/html",body:'<style>main{width:500px;height:300px;background:#eee}input,textarea,iframe{display:block;width:200px;height:40px}</style><main><h1>Visible proof</h1><input aria-label="Ordinary"><input type="password" aria-label="Password"><textarea aria-label="Note"></textarea><iframe srcdoc="PRIVATE FRAME"></iframe></main>'}));
    await page.goto("https://capture.test/");
    await page.getByRole("main").evaluate(element => {
      const editor=document.createElement("div");editor.contentEditable="true";editor.setAttribute("aria-label","Overflow");editor.setAttribute("role","textbox");
      editor.style.cssText="position:absolute;left:20px;top:260px;width:20px;height:10px;overflow:visible;font:24px monospace;white-space:nowrap;opacity:1!important";
      editor.innerHTML='<span style="opacity:1!important;visibility:visible!important"></span>';element.append(editor);
    });
    const images:Buffer[]=[],counts:number[]=[];
    const adapter=new BrowserRpaAdapter(page,"https://capture.test",{verifyGrant:async()=>true,receiveScreenshot:(_,bytes,count)=>{images.push(Buffer.from(bytes));counts.push(count);}});
    const step={stepId:"shot",action:"screenshot"as const,locator:{kind:"browser"as const,role:"main"},timeoutMs:5000};
    const signal=new AbortController().signal;
    await page.getByLabel("Note").focus();
    await adapter.perform(step,signal);
    await page.getByLabel("Ordinary").fill("PRIVATE_ORDINARY_CANARY");await page.getByLabel("Password").fill("PRIVATE_PASSWORD_CANARY");await page.getByLabel("Note").fill("PRIVATE_NOTE_CANARY");
    await page.getByLabel("Overflow").locator("span").evaluate(element=>{element.textContent="PRIVATE_OVERFLOW_CANARY";});
    await adapter.perform(step,signal);
    expect(counts).toEqual([5,5]);expect(images[0]).toEqual(images[1]);
    expect(await page.getByLabel("Overflow").evaluate(element=>(element as HTMLElement).style.getPropertyValue("opacity"))).toBe("1");
    await page.getByRole("heading").evaluate(el=>{el.textContent="Changed public proof";});
    await adapter.perform(step,signal);expect(images[2]).not.toEqual(images[0]);
    expect(images[0].subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    await page.getByRole("main").evaluate(el=>{(el as HTMLElement).style.width="2049px";});
    await expect(adapter.perform(step,signal)).rejects.toThrow("BLK-RPA-CAPTURE-003");
    expect(images).toHaveLength(3);images.forEach(bytes=>bytes.fill(0));
    const hidden=await concealCaptureInputs(page,page.locator("input"));
    try {
      await page.locator("input").first().evaluate(element=>{const style=(element as HTMLElement).style;style.setProperty("opacity","1","important");style.setProperty("opacity","0","important");});
      expect(await hidden.valid()).toBe(false);
    } finally {await hidden.restore();}
    const editors=page.locator('[contenteditable="true"]');
    const guarded=await concealCaptureInputs(page,editors);
    try {
      await editors.evaluateAll(elements=>{const old=elements[0] as HTMLElement;old.removeAttribute("contenteditable");old.removeAttribute("role");const replacement=document.createElement("div");replacement.contentEditable="true";replacement.textContent="PRIVATE_REPLACEMENT_CANARY";replacement.style.cssText="width:20px;height:10px;overflow:visible";old.after(replacement);});
      expect(await editors.count()).toBe(1);expect(await guarded.valid()).toBe(false);
    } finally {await guarded.restore();}
  }finally{
    await browser?.close();
    if(oldTemp===undefined)delete process.env.TEMP;else process.env.TEMP=oldTemp;
    if(oldTmp===undefined)delete process.env.TMP;else process.env.TMP=oldTmp;
    await rm(temporary,{recursive:true,force:true});
  }
},20000);
