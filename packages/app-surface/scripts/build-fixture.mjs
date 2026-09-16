import {readFile,mkdir,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
const files={};
for(const name of ["page.html","page.css","page.js"]) files[`src/${name}`]=(await readFile(`templates/${name}`,"utf8")).replace(/\r\n/g,"\n");
files["package.json"]=JSON.stringify({name:"blocky-app-surface",version:"0.1.0",private:true,type:"module",dependencies:{}},null,2)+"\n";
files["pnpm-lock.yaml"]="lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n";
const scriptHash=createHash("sha256").update(files["src/page.js"]).digest("base64");
await mkdir("src",{recursive:true});
await writeFile("src/sources.json",JSON.stringify({files,scriptHash},null,2)+"\n");
