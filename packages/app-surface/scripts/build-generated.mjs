import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = new URL("../src/", import.meta.url);
const script = await readFile(new URL("generated-runtime.js", base), "utf8");
const files = {
  "src/page.html":
    '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blocky</title><link rel="stylesheet" href="page.css"></head><body><template id="surface-spec"><!--BLOCKY_SPEC--></template><header><p>BLOCKY</p><h1 id="title"></h1><p id="description"></p></header><main id="layout"><form id="task-form"><div id="actions"><label id="attachment-label" hidden>文本附件<input id="attachment" type="file" accept=".txt,.md,.csv"></label><div class="buttons"><button id="submit" type="button" disabled>连接中…</button><button id="stop" type="button" disabled>停止</button></div></div></form><section aria-live="polite"><h2 id="result-title"></h2><p id="status"></p><details><summary>运行进度</summary><ol id="progress"></ol></details><div id="answer"></div><ul id="citations"></ul></section></main><script src="page.js"></script></body></html>\n',
  "src/page.css":
    ":root{font:16px system-ui,sans-serif;color:#20352c;background:#f3f6f1;color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:32px 24px}header,main{max-width:1100px;margin:auto}header>p:first-child{font-size:12px;letter-spacing:.18em;color:#4b7b61}h1{font-size:32px}h2{font-size:20px}main{display:grid;gap:24px;margin-top:32px}.split{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}form,section{background:#fff;padding:24px;border:1px solid #d6e0d7;border-radius:14px}form{display:flex;flex-direction:column;gap:12px}input,textarea,select{font:inherit;padding:12px;border:1px solid #afc1b4;border-radius:6px;min-width:0}textarea{min-height:140px;resize:vertical}label{font-weight:600}.buttons{display:flex;gap:10px;margin-top:18px}button{font:inherit;background:#286d4b;color:white;padding:12px 18px;border:0;border-radius:7px;cursor:pointer}button:disabled{opacity:.5}#stop{background:#596b60}#attachment-label input{display:block;width:100%;margin-top:8px}#answer{white-space:pre-wrap;line-height:1.7;overflow-wrap:anywhere}#status{color:#596b60}li{padding:6px} [hidden]{display:none!important}@media(max-width:700px){body{padding:20px 12px}.split{grid-template-columns:1fr}form,section{padding:18px}h1{font-size:26px}}\n",
  "src/page.js": script,
  "package.json": JSON.stringify({
    name: "blocky-generated-surface",
    version: "1.0.0",
    private: true,
    type: "module",
    dependencies: {},
  }),
  "pnpm-lock.yaml":
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
};
await writeFile(
  new URL("generated-sources.json", base),
  JSON.stringify(
    { files, scriptHash: createHash("sha256").update(script).digest("base64") },
    null,
    2,
  ) + "\n",
);
