const paths = {
  agent: "M4 4h16v12H9l-5 4zM8 8h8M8 12h5",
  builder: "M12 3v3M9 3h6M4 8h16v12H4zM8 12v2M16 12v2M8 17h8M1 12v4M23 12v4",
  add: "M12 5v14M5 12h14",
  history: "M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 2h4l1 4 4-1 2 4-3 3 3 3-2 4-4-1-1 4h-4l-1-4-4 1-2-4 3-3-3-3 2-4 4 1z",
  collapse: "m6 15 6-6 6 6",
  expand: "m6 9 6 6 6-6",
} as const;
export type UiIconName = keyof typeof paths;
export function UiIcon({name,className}:{name:UiIconName;className?:string}) {
  return <svg className={className} width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
