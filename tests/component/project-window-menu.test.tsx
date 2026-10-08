// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {ProjectWindowMenu} from "../../apps/studio-desktop/src/app/ProjectWindowMenu";
const native = vi.hoisted(() => ({enabled:true, invoke:vi.fn()}));
vi.mock("../../apps/studio-desktop/node_modules/@tauri-apps/api/core", () => ({isTauri:()=>native.enabled, invoke:native.invoke}));
afterEach(()=>{cleanup(); native.enabled=true; vi.clearAllMocks();});
it("lists actual windows and switches only to a returned window ID", async()=>{
  native.invoke.mockResolvedValueOnce([{id:"11",title:"刑法条文问答 — Blocky Studio",current:true},{id:"22",title:"CPI分析 — Blocky Studio",current:false}]).mockResolvedValueOnce(undefined);
  render(<ProjectWindowMenu title="刑法条文问答" dirty={false} newWindow={vi.fn()} onError={vi.fn()} />);
  fireEvent.click(screen.getByRole("button",{name:"切换作品：刑法条文问答"}));
  fireEvent.click(await screen.findByRole("menuitem",{name:"CPI分析"}));
  await waitFor(()=>expect(native.invoke).toHaveBeenLastCalledWith("focus_studio_window",{id:"22"}));
  expect(screen.queryByRole("menu")).toBeNull();
});
it("ignores a late window listing after Escape and exposes new-window action", async()=>{
  let finish!:(value:unknown)=>void;
  native.invoke.mockReturnValueOnce(new Promise(resolve=>finish=resolve));
  const create=vi.fn(async()=>{});
  render(<ProjectWindowMenu title="作品" dirty newWindow={create} onError={vi.fn()} />);
  const anchor=screen.getByRole("button",{name:"切换作品：作品"});
  fireEvent.click(anchor); fireEvent.keyDown(anchor,{key:"Escape"});
  finish([{id:"stale",title:"过期窗口",current:false}]);
  await waitFor(()=>expect(screen.queryByRole("menu")).toBeNull());
  native.invoke.mockResolvedValueOnce([]);
  fireEvent.click(anchor);
  fireEvent.click(screen.getByRole("menuitem",{name:"＋ 新建窗口"}));
  expect(create).toHaveBeenCalledOnce();
});
it("keeps the project title without native window actions in browser previews",()=>{
  native.enabled=false;
  render(<ProjectWindowMenu title="作品" dirty={false} newWindow={vi.fn()} onError={vi.fn()} />);
  expect(screen.getByText("作品")).toBeTruthy(); expect(screen.queryByRole("button")).toBeNull();
});
