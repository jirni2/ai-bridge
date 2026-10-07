/* v5.9.4: regression tests for every finding of the v5.9.3 production audit. */
import fs from "node:fs";import vm from "node:vm";import path from "node:path";import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const stamp=Date.now(),tmpA=path.join(root,"tests",`worker-v594-a-${stamp}.mjs`),tmpB=path.join(root,"tests",`worker-v594-b-${stamp}.mjs`);
fs.copyFileSync(path.join(root,"_worker.js"),tmpA);fs.copyFileSync(path.join(root,"_worker.js"),tmpB);
try{
  const W=await import(pathToFileURL(tmpA).href),W2=await import(pathToFileURL(tmpB).href);
  // 1. hidden HTML filter
  const T=h=>W.htmlToAgentText(h);
  ok(T('<body><p hidden>secret banner<div>VISIBLE MAIN CONTENT</div></body>').includes("VISIBLE MAIN CONTENT")&&!T('<body><p hidden>secret banner<div>VISIBLE MAIN CONTENT</div></body>').includes("secret"),"unclosed <p hidden> no longer hides the rest of the page");
  const li=T('<ul><li hidden>a<li>VISIBLE ITEM</ul><p>AFTER</p>');ok(li.includes("VISIBLE ITEM")&&li.includes("AFTER"),"unclosed <li hidden> hides only itself");
  const cls=T('<div class="hidden">HIDDEN_X</div><div>VISIBLE</div>');ok(!cls.includes("HIDDEN_X")&&cls.includes("VISIBLE"),'class="hidden" (single class) is detected');
  ok(!T('<div class="card d-none">D</div>ok').includes("D")||T('<div class="card d-none">D</div>ok').trim()==="ok","utility class d-none is detected");
  ok(T('<span title="this is not hidden">VISIBLE LABEL</span>').includes("VISIBLE LABEL"),'the word "hidden" inside another attribute value no longer hides content');
  ok(T('<button data-state="hidden">VISIBLE BUTTON</button>').includes("VISIBLE BUTTON"),"data-* values are not treated as the hidden attribute");
  ok(!T('<div aria-hidden="true">ARIA</div><div style="display: none">NONE</div><div style="visibility:hidden">VIS</div>x').match(/ARIA|NONE|VIS/),"aria-hidden, display:none and visibility:hidden are removed");
  ok(T('<table><tr><td hidden>H<td>CELL<tr><td>ROW2</table>').match(/CELL[\s\S]*ROW2/)&&!T('<table><tr><td hidden>H<td>CELL</table>').includes("H "),"implicitly closed table cells behave like browsers");
  let big="<div>"+"<span>x".repeat(20000)+"</div>",t0=Date.now();W.htmlToAgentText(big);ok(Date.now()-t0<1500,"filter stays fast on pathological markup");
  // 2. Work Controller acceptance
  ok(!W.workResultUsable("OK")&&!W.workResultUsable("Done.")&&!W.workResultUsable("Looks good!"),"acknowledgements are not accepted as provider answers");
  ok(!W.workResultUsable("I cannot review the file because I do not have the full code."),"refusals are not accepted as provider answers");
  ok(W.workResultUsable("42")&&W.workResultUsable("Kyiv")&&W.workResultUsable("The bug is on line 12: off-by-one in the loop bound."),"genuinely short and normal answers are still accepted");
  ok(W.consensusProviderFallback([{provider:"a",ok:true,text:"OK"},{provider:"b",ok:true,text:"ok"}])===null,"two identical acknowledgements are not a consensus answer");
  // 3. internal files are not downloadable
  for(const p of ["/tests/worker-v38-under-test.mjs","/tools/smoke-test.mjs","/CHANGELOG_v5_9_3.txt","/AUDIT_v5_8_0.txt","/README.txt","/MANIFEST.sha256.json","/%74ests/run_v39_zip_safety_tests.mjs","//tests/x.mjs","/improvements/validated/x.patch","/oauth-replay-do.js","/chatgpt-app-submission.json"])ok(W.isInternalAssetPath(p),`blocked: ${p}`);
  for(const p of ["/","/index.html","/app.js","/styles.css","/markdown.js","/bridge-version.json","/privacy","/work/","/icon-192.png","/manifest.webmanifest"])ok(!W.isInternalAssetPath(p),`served: ${p}`);
  const env={BRIDGE_ACCESS_TOKEN:"t",ASSETS:{fetch:async()=>new Response("asset",{status:200})}};
  const r1=await W.default.fetch(new Request("https://b.example/tests/worker-v38-under-test.mjs"),env,{waitUntil(){}});
  const r2=await W.default.fetch(new Request("https://b.example/app.js"),env,{waitUntil(){}});
  ok(r1.status===404&&r1.headers.get("x-frame-options")==="DENY"&&r2.status===200,"live handler returns 404 for internal files and still serves the app");
  // 4. OAuth replay across isolates via KV
  const store=new Map(),kv={get:async k=>store.get(k)??null,put:async(k,v)=>{store.set(k,v)}},kvEnv={AI_BRIDGE_JOBS:kv};
  ok(await W.consumeOAuthJti(kvEnv,"jti-1",300)===true,"first use of a code is accepted");
  ok(await W2.consumeOAuthJti(kvEnv,"jti-1",300)===false,"replay on another isolate is rejected when KV is bound");
  ok(await W2.consumeOAuthJti({},"jti-2",300)===true&&await W2.consumeOAuthJti({},"jti-2",300)===false,"same-isolate replay protection still works without KV");
}finally{fs.rmSync(tmpA,{force:true});fs.rmSync(tmpB,{force:true})}
// 5. Deep Scan sends whole large files
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),from=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b));
const body="line of code\n".repeat(6000)+"SECRET_MIDDLE_BUG here\n"+"line of code\n".repeat(5500);
const files=[{name:"big.js",text:body},{name:"b2.js",text:"x\n".repeat(80000)},{name:"b3.js",text:"y\n".repeat(80000)}];
const src=`const MAX_CONTEXT_CHARS=350000,ZIP_FILE_SAMPLE_CHARS=180000;let attachments=[{name:"p.zip",kind:"zip",files:${JSON.stringify(files)},manifestNames:${JSON.stringify(files.map(f=>f.name))},chars:1}];
const safeFileLabel=s=>s;const neutralizeEmbeddedFileTags=s=>s;
${from("function buildFileContext(){","async function readApiJson")}
const plan=planDeepScanParts("review the architecture");const ctxs=plan.parts.map(only=>buildFileContext({task:"review the architecture",only}));
({parts:plan.totalParts,sizes:ctxs.map(c=>c.length),hasMiddle:ctxs.some(c=>c.includes("SECRET_MIDDLE_BUG")),allFiles:attachments[0].files.every(f=>ctxs.some(c=>c.includes('path="'+f.name+'"')))});`;
const out=vm.runInNewContext(src,{console});
ok(out.hasMiddle,"Deep Scan now sends the middle of a 150k-char file (was cut to 36k)");
ok(out.allFiles&&out.sizes.every(n=>n<=372000),`every file is covered and each part stays within the request budget (${out.parts} parts)`);
// 6. version labels synced
const v=JSON.parse(fs.readFileSync(path.join(root,"bridge-version.json"),"utf8")).version,html=fs.readFileSync(path.join(root,"index.html"),"utf8");
ok(html.includes(`class="heroVersion">v${v}<`)&&html.includes(`Advanced Controller</a><span>v${v}<`),"hero badge and sidebar show the real version");
ok(fs.readFileSync(path.join(root,"tools/sync-version.mjs"),"utf8").includes("heroVersion"),"sync-version now updates the visible labels");
console.log("v5.9.4 audit fix tests PASS");
