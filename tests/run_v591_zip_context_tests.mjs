/* v5.9.1: ZIP coverage + task-aware context + URL hyphen normalization. */
import fs from "node:fs";import vm from "node:vm";import path from "node:path";import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
vm.runInThisContext(fs.readFileSync(path.join(root,"zip-safety-core.js"),"utf8"));
const Z=globalThis.ZipSafetyCore;
function eocd(n,off){const b=Buffer.alloc(22);b.writeUInt32LE(0x06054b50,0);b.writeUInt16LE(n,8);b.writeUInt16LE(n,10);b.writeUInt32LE(off,16);return b}
function central(name,comp,uncomp){const n=Buffer.from(name),b=Buffer.alloc(46+n.length);b.writeUInt32LE(0x02014b50,0);b.writeUInt32LE(comp,20);b.writeUInt32LE(uncomp,24);b.writeUInt16LE(n.length,28);n.copy(b,46);return b}
const fake=meta=>new Uint8Array(Buffer.concat([...meta.map((x,i)=>central(`f${i}.js`,x.comp,x.uncomp)),eocd(meta.length,0)]));
const mixed=fake([{comp:100,uncomp:1000},{comp:10,uncomp:5000},{comp:100,uncomp:2100000},{comp:100,uncomp:900}]);
let threw=false;try{Z.scanZipMeta(mixed)}catch(e){threw=true}
ok(threw,"strict default still rejects suspicious entries (zip-bomb guard unchanged)");
const r=Z.scanZipMeta(mixed,{skipSuspicious:true});
ok(r.entries===4&&r.suspicious.length===2&&r.suspicious.some(x=>x.reason==="compression_ratio")&&r.suspicious.some(x=>x.reason==="declared_size"),"one suspicious entry is skipped and reported instead of rejecting the whole project");
ok(r.totalDeclared===1900,"skipped entries do not count toward the declared total");
let many=false;try{Z.scanZipMeta(fake(Array.from({length:513},()=>({comp:0,uncomp:0}))),{skipSuspicious:true})}catch(e){many=/too many entries/.test(e.message)}
ok(many,"entry-count limit still applies with skipSuspicious");
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),worker=fs.readFileSync(path.join(root,"zip-worker.js"),"utf8");
ok(app.includes("skipSuspicious:true")&&worker.includes("skipSuspicious:true"),"both ZIP extractors skip (and count) suspicious entries");
ok(worker.includes("stats.overBudget")&&app.includes("function fileCoverageText("),"extraction reports found / read / skipped counts with reasons");
// task-aware context in a sandbox (same slice style as run_v585)
const from=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b));
const big=n=>"filler line\n".repeat(n);
const files=[{name:"sw.js",text:"self.addEventListener('fetch',()=>{})\n"+big(2000)},...Array.from({length:60},(_,i)=>({name:`src/m${i}.js`,text:big(1200)})),{name:"src/billing/checkout.js",text:"// checkout total bug\nfunction checkoutTotal(){}\n"+big(1200)}];
const source=`const MAX_CONTEXT_CHARS=350000,ZIP_FILE_SAMPLE_CHARS=180000;let attachments=[{name:"p.zip",kind:"zip",files:${JSON.stringify(files)},manifestNames:${JSON.stringify(files.map(f=>f.name))},chars:1}];
const safeFileLabel=s=>String(s).replace(/[<>"']/g,"_");const neutralizeEmbeddedFileTags=s=>String(s);
function priorityPath(name){const n=name.toLowerCase();let p=0;if(/\\.js$/.test(n))p+=40;if(/(?:^|\\/)(?:sw|service-worker)\\.js$/.test(n))p-=60;return p}
${from("function buildFileContext(){","async function readApiJson")}
({ctx:buildFileContext({task:"Fix the checkout total bug"}),plain:buildFileContext(),plan:planDeepScanParts("checkout")});`;
const out=vm.runInNewContext(source,{console});
const order=[...out.ctx.matchAll(/<file path="([^"]+)"/g)].map(m=>m[1]);
ok(order[0]==="src/billing/checkout.js","the file matching the user's task is sent first");
ok(order.indexOf("sw.js")===-1||order.indexOf("sw.js")>order.length-5,"sw.js boilerplate is sent last or not at all");
ok(order.length>=30,`two-pass packing sends more files per request than the old 36k round-robin (~22 here) (${order.length} of ${files.length})`);
ok(out.ctx.length<375000,"request context stays within the provider budget");
ok(out.plan.parts.length>=1&&out.plan.files===files.length,"Deep Scan plans parts covering every extracted file");
// URL hyphen normalization
const tmp=path.join(root,"tests",`worker-v591-zip-${Date.now()}.mjs`);fs.copyFileSync(path.join(root,"_worker.js"),tmp);
try{
  const m=await import(pathToFileURL(tmp).href);
  ok(new URL(m.normalizeUrlHyphens("https://ai‑bridge‑aff.pages.dev/x")).host==="ai-bridge-aff.pages.dev","typographic hyphens in URLs no longer turn into xn-- punycode hosts");
  ok(m.normalizeUrlHyphens("https://exa​mple.com")==="https://example.com","invisible characters are removed from URLs");
}finally{fs.rmSync(tmp,{force:true})}
vm.runInThisContext(fs.readFileSync(path.join(root,"markdown.js"),"utf8").replace("(globalThis)","(globalThis)"));
ok(globalThis.AIBridgeMarkdown.safeUrl("https://ai‐bridge.pages.dev")==="https://ai-bridge.pages.dev/","Markdown links normalize hyphens too");
console.log("v5.9.1 ZIP/context tests PASS");
