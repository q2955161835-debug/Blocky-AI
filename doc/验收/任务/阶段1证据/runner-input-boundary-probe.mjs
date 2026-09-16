import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const current=readFileSync('tests/e2e/core.e2e.ts','utf8');
const old=execFileSync('git',['show','58d8c04^:tests/e2e/core.e2e.ts'],{encoding:'utf8'});
async function compile(source){
 const result=await build({stdin:{contents:source,loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'iife',plugins:[{name:'boundaries',setup(b){
  b.onResolve({filter:/.*/},args=>({path:args.path,namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},args=>({loader:'js',contents:args.path==='@wdio/globals'?'export const browser=globalThis.boundary.browser;export const expect=globalThis.boundary.expect;':args.path==='playwright-core'?'export const chromium=globalThis.boundary.chromium;':args.path==='node:crypto'?'export const createHash=globalThis.boundary.createHash;export const randomUUID=()=>"probe-run";':'export const mkdir=globalThis.boundary.mkdir;export const writeFile=globalThis.boundary.writeFile;export const appendFile=globalThis.boundary.appendFile;export const readFile=globalThis.boundary.readFile;'}));
 }}]});return result.outputFiles[0].text;
}
async function run(code,mode){
 let clock=0,cycle=0,hook,afterHook;const tests=[],files=new Map();
 const sandbox={console:{log(){}},process:{env:{BLOCKY_NATIVE_SUITE:'full',BLOCKY_TEST_CDP_PORT:'1'}},URL,Element:class {},performance:{now:()=>clock}};
 sandbox.Date=class extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
 sandbox.setTimeout=(fn,ms)=>{clock+=ms;if(cycle===360&&mode==='late')sandbox.window.__BLOCKY_SOAK_INPUT__.observations.push({type:'keydown',timeMs:clock,targetTag:'DIV'});fn();};
 sandbox.window={addEventListener(){},removeEventListener(){},__BLOCKY_ACCEPTANCE__:{startSoak:async()=>({blocks:100,nodes:100}),cycle:async n=>{cycle=n;return{cycle:n,blocks:100,nodes:100,viewEvents:20,logRecords:100,roundTrip:n%12===0};}}};
 const page={url:()=> 'http://tauri.localhost/',waitForFunction:async fn=>assert.ok(fn()),on(){},context:()=>({newCDPSession:async()=>({send:async()=>({usedSize:1024}),detach:async()=>{}})}),evaluate:async(fn,arg)=>{if(mode==='unreadable'&&String(fn).includes('monitor.stop'))throw Error('monitor unavailable');return fn(arg);}};
 const expect=v=>({toBe:x=>assert.equal(v,x),toEqual:x=>assert.equal(JSON.stringify(v),JSON.stringify(x)),toBeLessThanOrEqual:x=>assert.ok(v<=x),toBeGreaterThanOrEqual:x=>assert.ok(v>=x),toBeGreaterThan:x=>assert.ok(v>x)});
 sandbox.boundary={browser:{},expect,chromium:{connectOverCDP:async()=>({contexts:()=>[{pages:()=>[page]}],close:async()=>{}})},mkdir:async()=>{},writeFile:async(p,s)=>files.set(p,s),appendFile:async(p,s)=>files.set(p,(files.get(p)||'')+s),readFile:async()=>new Uint8Array([1,2,3]),createHash:()=>({update(){return this},digest:()=> 'controlled-binary-hash'})};
 sandbox.describe=(_,fn)=>fn.call({timeout(){}});sandbox.before=fn=>hook=fn;sandbox.after=fn=>afterHook=fn;sandbox.it=(name,fn)=>tests.push({name,fn});
 vm.runInNewContext(code,sandbox);await hook();let thrown;
 try{await tests.find(t=>t.name.includes('360 five-second')).fn();}catch(e){thrown=e.message;}await afterHook();
 const report=JSON.parse(files.get('try/stage1-core/full.json'));return{mode,thrown:thrown??null,passed:report.passed,cycles:report.cycles,roundTrips:report.roundTrips,elapsedMs:report.elapsedMs,trustedInput:report.trustedInput,failure:report.failure??null};
}
const oldCode=await compile(old),newCode=await compile(current);
const historical=await run(oldCode,'late'),fixed=await run(newCode,'late'),clean=await run(newCode,'clean'),unreadable=await run(newCode,'unreadable');
assert.equal(historical.passed,true);assert.equal(historical.thrown,null);assert.equal(historical.trustedInput.length,1);
assert.equal(fixed.passed,false);assert.ok(fixed.thrown);assert.equal(fixed.trustedInput.length,1);
assert.equal(clean.passed,true);assert.equal(clean.thrown,null);
assert.equal(unreadable.passed,false);assert.ok(unreadable.thrown);assert.equal(unreadable.trustedInput,null);
for(const r of [historical,fixed,clean,unreadable]){assert.equal(r.cycles,360);assert.equal(r.roundTrips,30);assert.equal(r.elapsedMs,1800000);}
console.log(JSON.stringify({kind:'isolated-runner-simulation-not-native-soak',historical,fixed,clean,unreadable},null,2));
