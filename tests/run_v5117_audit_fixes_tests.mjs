/* v5.11.7: live-audit fixes — real 404 page, robots.txt, legal pages, accurate storage wording. */
import fs from "node:fs";import path from "node:path";import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const r=f=>fs.readFileSync(path.join(root,f),"utf8");
const nf=r("404.html");ok(/<meta name="robots" content="noindex">/.test(nf)&&/href="\/"/.test(nf)&&!/<script/i.test(nf),"404.html exists (Pages then returns real 404s instead of the app for unknown paths), noindex, no scripts");
ok(/^User-agent: \*\nDisallow: \/$/m.test(r("robots.txt")),"robots.txt tells search engines not to index the private app");
const pv=r("privacy.html"),tm=r("terms.html");
ok(/Optional exchange connection/.test(pv)&&/never be pasted into chat/.test(pv)&&/September 30, 2026/.test(pv),"privacy covers the optional exchange connection and is re-dated");
ok(/no investment advice/i.test(tm)&&/lose money/.test(tm)&&/permitted to serve residents/.test(tm)&&/September 30, 2026/.test(tm),"terms carry a financial-risk disclaimer and are re-dated");
const i18n=r("i18n.js");ok((i18n.match(/brainPrivacy:"[^"]*(sync|синхроніз|синхрониз)/g)||[]).length===3&&!/Task texts, answers, files and keys are never stored/.test(i18n),"learning-privacy text no longer claims task texts are never stored anywhere (history sync exists)");
const tmp=path.join(root,"tests",`worker-v5117-${Date.now()}.mjs`);fs.copyFileSync(path.join(root,"_worker.js"),tmp);
try{const m=await import(pathToFileURL(tmp).href);ok(!m.isInternalAssetPath("/404.html")&&!m.isInternalAssetPath("/robots.txt")&&m.isInternalAssetPath("/tests/x.mjs"),"404.html and robots.txt are servable; internal paths stay blocked")}finally{fs.rmSync(tmp,{force:true})}
console.log("v5.11.7 audit fixes tests PASS");
