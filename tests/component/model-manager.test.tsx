// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useResources } from "../../apps/studio-desktop/src/composition/useResources";
import { ModelManagerPanel } from "../../apps/studio-desktop/src/app/ModelManagerPanel";
import { PreferenceRows } from "../../apps/studio-desktop/src/app/settings/PreferenceRows";
import { createSettings } from "../../packages/settings-core/src";
import type { Studio } from "../../apps/studio-desktop/src/composition/useStudio";
import { modelResource } from "../fixtures/model-resource";
const provider={schemaVersion:"blocky.model-provider/v1",providerId:"shared",displayName:"Shared vendor",adapter:"xirang",protocol:"openai-chat",revision:1,secretBindings:[{fieldId:"apiKey",secretRef:"saved-model-secret"}]};
const model=(id:string)=>({...modelResource(id),displayName:`Model ${id}`,definition:{connectionRef:"shared",modelId:id,timeoutMs:60000,capabilities:["text"],parameters:{maxOutputTokens:512}},secretBindings:[]});
afterEach(()=>{cleanup();vi.restoreAllMocks();localStorage.clear();});
it("publishes resource changes only after persistence and retains drafts on storage failure",async()=>{
  const hook=renderHook(()=>useResources(()=>{}));await waitFor(()=>expect(hook.result.current.ready).toBe(true));
  await act(()=>hook.result.current.upsertProvider(provider));
  for(const id of ["one","two"]) await act(()=>hook.result.current.upsert(model(id)));
  expect(hook.result.current.map.get("two")!.definition.connectionRevision).toBe(1);
  const persisted=localStorage.getItem("blocky.resources.app");
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("write failed");});
  await act(async()=>{await expect(hook.result.current.upsertProvider({...provider,displayName:"Unsaved"})).rejects.toThrow();});
  expect(hook.result.current.registry.providers[0].displayName).toBe("Shared vendor");
  expect(localStorage.getItem("blocky.resources.app")).toBe(persisted);
});
it("refreshes a concurrent registry without overwriting it and preserves pending edits",async()=>{
  const a=renderHook(()=>useResources(()=>{})),b=renderHook(()=>useResources(()=>{}));
  await waitFor(()=>expect(a.result.current.ready&&b.result.current.ready).toBe(true));
  await act(()=>a.result.current.upsertProvider(provider));
  await act(async()=>{await expect(b.result.current.upsertProvider({...provider,providerId:"other"})).rejects.toThrow("BLK-RESOURCE-CONFLICT");});
  expect(b.result.current.registry.providers.map(p=>p.providerId)).toEqual(["shared"]);
  await act(()=>b.result.current.upsertProvider({...provider,providerId:"other"}));
  expect(b.result.current.registry.providers).toHaveLength(2);
});
it("shows vendor models and default groups and retains a failed provider edit",async()=>{
  localStorage.setItem("blocky.resources.app",JSON.stringify({schemaVersion:"blocky.resource-registry/v2",revision:3,providers:[provider],resources:[model("one"),model("two")]}));
  let resources:ReturnType<typeof useResources>;
  const defaults=vi.fn();
  function Harness(){ resources=useResources(()=>{});return <ModelManagerPanel resources={resources} defaultModelId="two" setDefault={defaults} reference={vi.fn()}/>; }
  render(<Harness/>);await waitFor(()=>expect(screen.getByText("Shared vendor")).toBeTruthy());
  expect(screen.getByText("Model one")).toBeTruthy();expect(screen.getByText("Model two")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"编辑厂商 Shared vendor"}));
  fireEvent.change(screen.getByLabelText("厂商名称"),{target:{value:"Unsaved vendor"}});
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("write failed");});
  fireEvent.click(screen.getByRole("button",{name:"保存厂商"}));
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("未保存"));
  expect((screen.getByLabelText("厂商名称") as HTMLInputElement).value).toBe("Unsaved vendor");
  expect(resources!.registry.providers[0].displayName).toBe("Shared vendor");
  const studio={resources:resources!,settings:{ready:true,error:"",layers:{app:createSettings("app")},change:vi.fn()},resetLayout:vi.fn(),session:{leftWidth:260,rightWidth:340,bottomHeight:240},setSession:vi.fn()} as unknown as Studio;
  render(<PreferenceRows studio={studio} ids={["models.defaultResourceId"]}/>);
  expect(screen.getByRole("group",{name:"Shared vendor"})).toBeTruthy();
});
it("edits model identity, capabilities and parameters without duplicating provider credentials",async()=>{
  localStorage.setItem("blocky.resources.app",JSON.stringify({schemaVersion:"blocky.resource-registry/v2",revision:2,providers:[provider],resources:[model("one")]}));
  let resources:ReturnType<typeof useResources>;
  const setDefault=vi.fn(async()=>{});
  function Harness(){resources=useResources(()=>{});return <ModelManagerPanel resources={resources} defaultModelId="" setDefault={setDefault} reference={vi.fn()}/>;}
  render(<Harness/>);await waitFor(()=>expect(screen.getByText("Model one")).toBeTruthy());
  fireEvent.click(screen.getByRole("button",{name:"编辑模型 Model one"}));
  expect(screen.queryByLabelText("apiKey秘密引用")).toBeNull();
  fireEvent.change(screen.getByLabelText("模型显示名称"),{target:{value:"Edited model"}});
  fireEvent.change(screen.getByLabelText("模型 ID"),{target:{value:"actual-id"}});
  fireEvent.click(screen.getByLabelText("模型能力 工具调用"));
  fireEvent.change(screen.getByLabelText("模型参数 输出 Token 上限"),{target:{value:"2048"}});
  fireEvent.click(screen.getByRole("button",{name:"保存模型"}));
  await waitFor(()=>expect(screen.queryByLabelText("模型显示名称")).toBeNull());
  expect(resources!.map.get("one")).toMatchObject({resourceId:"one",displayName:"Edited model",definition:{modelId:"actual-id",capabilities:["text","tools"],parameters:{maxOutputTokens:2048}},secretBindings:provider.secretBindings});
  expect(resources!.registry.resources[0].secretBindings).toEqual([]);
  fireEvent.click(screen.getByRole("button",{name:"设为默认"}));
  await waitFor(()=>expect(setDefault).toHaveBeenCalledWith("one"));
});
