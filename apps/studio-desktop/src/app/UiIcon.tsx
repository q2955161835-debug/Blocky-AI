const paths = {
  agent: "M4 4h16v12H9l-5 4zM8 8h8M8 12h5",
  builder: "M12 3v3M9 3h6M4 8h16v12H4zM8 12v2M16 12v2M8 17h8M1 12v4M23 12v4",
  add: "M12 5v14M5 12h14",
  history: "M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 2h4l1 4 4-1 2 4-3 3 3 3-2 4-4-1-1 4h-4l-1-4-4 1-2-4 3-3-3-3 2-4 4 1z",
  collapse: "m6 15 6-6 6 6",
  expand: "m6 9 6 6 6-6",
  file: "M3 5h7l2 3h9v12H3z",
  edit: "m4 17-1 4 4-1L20 7l-4-4zM14 5l5 5",
  view: "M3 4h18v16H3zM9 4v16M9 11h12",
  run: "m7 4 14 8-14 8z",
  terminal: "M3 4h18v16H3zM6 9l4 3-4 3M12 16h6",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9 9a3 3 0 1 1 5 2c-1 1-2 1-2 3M12 17h.01",
} as const;
export type UiIconName = keyof typeof paths;
export function UiIcon({name,className}:{name:UiIconName;className?:string}) {
  return <svg className={className} width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
