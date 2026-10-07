/* AI Bridge v5.8.0 UI regression tests: God Mode pipeline, route badges,
   verification panel, safe links, Work Controller Pause/Resume/Stop/Reconnect,
   stale-job resubmission and mobile layout. Static checks always run; live
   browser checks run when Playwright + Chromium are available (otherwise they
   are reported as SKIPPED, never as passed). */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const root=path.resolve(new URL("..",import.meta.url).pathname);
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
let passed=0,skipped=0;
function ok(c,m){if(!c)throw new Error("FAIL: "+m);passed++;console.log("PASS:",m)}
const app=read("app.js"),html=read("index.html"),css=read("styles.css"),i18n=read("i18n.js"),wc=read("work-controller.js"),work=read("work.html"),work2=read("work/index.html");

/* ---------- static contract ---------- */
ok(html.includes('id="pipeline"')&&html.includes('id="routeBadge"')&&html.includes('id="verificationPanel"'),"chat UI has pipeline, route badge and verification panel surfaces");
ok(html.includes('data-quick="god"'),"God Mode is one tap away in the quick mode row");
ok(app.includes('const PIPE_STAGES=["search","plan","tools","ai","verify","learn"]'),"pipeline shows SEARCH/PLAN/TOOLS/AI/VERIFY/LEARN");
ok(app.includes("function renderLinkedText(")&&app.includes("document.createTextNode")&&!/finalAnswer"\)\.innerHTML/.test(app),"answer links are built with DOM APIs, never innerHTML");
ok(app.includes("routeSearchOnly")&&i18n.includes('routeSearchOnly:"NO AI USED"')&&i18n.includes('routeSearchAi:"AI + SOURCES"'),"route badges label NO AI USED / AI + SOURCES");
ok(app.includes("resubmitPendingJob")&&app.includes('j.status==="stale"')&&app.includes("savePendingPayload(clientRequestId,payload)"),"stale/lost jobs are resubmitted once with the same clientRequestId");
ok(app.includes("setStatusState(")&&css.includes(".brand p.stateBad:before"),"status dot colour reflects the real Bridge state");
for(const id of ["pauseBtn","resumeBtn","stopBtn","reconnectBtn"])ok(work.includes(`id="${id}"`)&&work2.includes(`id="${id}"`)&&wc.includes(`$("${id}")`),`Work Controller ${id} exists in both pages and is wired`);
ok(wc.includes("WORK_STREAM_IDLE_MS=45000")&&wc.includes("readWithIdleTimeout("),"Work Controller streams have an inactivity timeout (no infinite spinner)");
ok(wc.includes('data.status==="stale"'),"Work Controller treats stale server jobs as terminal");
ok(css.includes(".pipeStep.active")&&css.includes("@media(max-width:560px)")&&css.includes("prefers-reduced-motion"),"pipeline styling is mobile-first and respects reduced motion");

/* ---------- live browser checks ---------- */
let chromium=null;
for(const candidate of ["playwright",path.join(process.env.HOME||"","/.npm-global/lib/node_modules/playwright/index.mjs"),"/home/claude/.npm-global/lib/node_modules/playwright/index.mjs"]){
  try{const mod=await import(candidate);chromium=mod.chromium||mod.default?.chromium;if(chromium)break}catch(e){}
}
let browser=null;
if(chromium){try{browser=await chromium.launch()}catch(e){browser=null}}
if(!browser){skipped++;console.log("SKIP: live browser checks (Playwright/Chromium not available on this machine)")}
else{
  const types={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".webmanifest":"application/manifest+json"};
  const ver=JSON.parse(read("bridge-version.json")).version;
  const godResult={version:ver,selectedProviders:["groqfree","openrouter"],results:[],final:"Answer with source https://example.org/a and <img src=x onerror=alert(1)>",judge:null,meta:{mode:"god",godMode:true,route:"god",pipeline:[{stage:"search",status:"done"},{stage:"plan",status:"done"},{stage:"tools",status:"skipped"},{stage:"ai",status:"done"},{stage:"verify",status:"done"},{stage:"learn",status:"done"}],verificationReport:{verdict:"pass",verifier:"openrouter",independent:true,observedEvidence:1,evidenceSources:["https://example.org/a"],claims:{observed:["fact A"],inferred:[],unverified:["claim B"]},issues:[]},verificationSummary:"Observed by tools: 1",webSearch:{query:"q",provider:"duckduckgo",results:[{title:"A",url:"https://example.org/a"}]}}};
  const resubmits=new Map();
  const server=http.createServer((req,res)=>{let p=decodeURIComponent(new URL(req.url,"http://x").pathname);
    if(p==="/api/status"){res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({version:ver,configured:true,providers:{groqfree:true,gemini:true,openrouter:true},models:{},jobsPersistent:true,jobsDurable:false}))}
    if(p==="/api/run-stream"){res.writeHead(200,{"content-type":"application/x-ndjson"});res.write(JSON.stringify({type:"start",jobId:"j"})+"\n");res.write(JSON.stringify({type:"heartbeat",jobId:"j",progress:{phase:"verifying",tool:"independent_verify",pipeline:[{stage:"search",status:"done"},{stage:"verify",status:"active"}]}})+"\n");setTimeout(()=>{res.write(JSON.stringify({type:"result",jobId:"j",data:godResult})+"\n");res.end()},600);return}
    if(p==="/api/job/status"){const cid=new URL(req.url,"http://x").searchParams.get("clientRequestId");res.writeHead(200,{"content-type":"application/json"});
      if(!resubmits.has("stale-reload"))return res.end(JSON.stringify({jobId:"js",status:"stale",resubmit:true,retryable:true,error:{errorKind:"job_stale",error:"lost"}}));
      return res.end(JSON.stringify({jobId:"js",status:"done",result:{...godResult,final:"RECOVERED AFTER ISOLATE RESTART"}}))}
    if(p==="/api/job/submit"){let b="";req.on("data",c=>b+=c);req.on("end",()=>{const j=JSON.parse(b);resubmits.set(j.clientRequestId,j.prompt);res.writeHead(202,{"content-type":"application/json"});res.end(JSON.stringify({jobId:"js",status:"processing"}))});return}
    if(p==="/api/work/provider-stream"){let b="";req.on("data",c=>b+=c);req.on("end",()=>{const j=JSON.parse(b);res.writeHead(200,{"content-type":"application/x-ndjson"});res.write(JSON.stringify({type:"provider_start",provider:j.provider,jobId:"job-"+j.provider})+"\n");const t=setInterval(()=>{try{res.write(JSON.stringify({type:"provider_attempt",provider:j.provider,attempt:1,maxAttempts:2})+"\n")}catch(e){clearInterval(t)}},300);req.on("close",()=>clearInterval(t))});return}
    if(p==="/api/work/provider-status"){const id=new URL(req.url,"http://x").searchParams.get("jobId")||"",prov=id.replace("job-","");res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({jobId:id,status:"done",kind:"work_provider",provider:prov,result:{provider:prov,ok:true,text:prov+" done",ms:5}}))}
    if(p==="/api/work/synthesize-stream"){res.writeHead(200,{"content-type":"application/x-ndjson"});return res.end(JSON.stringify({type:"final",data:{final:"RESUMED SYNTHESIS",judge:"gemini",meta:{}}})+"\n")}
    if(p.startsWith("/api/")){res.writeHead(404,{"content-type":"application/json"});return res.end("{}")}
    if(p.endsWith("/"))p+="index.html";const f=path.join(root,p);if(!f.startsWith(root)||!fs.existsSync(f)){res.writeHead(404);return res.end()}
    res.writeHead(200,{"content-type":types[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(res)});
  await new Promise(r=>server.listen(0,r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
    const page=await ctx.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
    let alerted=false;page.on("dialog",d=>{alerted=true;d.dismiss()});
    await page.goto(base+"/");await page.waitForLoadState("networkidle").catch(()=>{});await page.waitForTimeout(500);
    // v5.11.94: сторінка може перезавантажитись (self-update) — повторити evaluate
    let overflow=0;
    for(let i=0;i<3;i++){
      try{overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);break;}
      catch(e){if(i===2)throw e;await page.waitForTimeout(700);}
    }
    ok(overflow<=1,"iPhone-width layout has no horizontal overflow");
    if(!(await page.evaluate(()=>document.getElementById("composerOpts")?.open??true)))await page.click("#composerOpts > summary"); // v5.11.7: mode chips now live in the collapsed composer options
    await page.click('[data-quick="god"]');await page.fill("#prompt","test question");await page.click("#sendBtn");
    await page.waitForSelector("#pipeline:not(.hidden) .pipeStep.active",{timeout:5000});
    ok(await page.locator("#pipeline .pipeStep").count()===6,"live pipeline renders six stages while God Mode runs");
    await page.waitForSelector("#verificationPanel:not(.hidden)",{timeout:6000});
    ok((await page.textContent("#routeBadge")).includes("GOD"),"route badge shows GOD MODE");
    ok(await page.locator("#finalAnswer a[href='https://example.org/a']").count()===1&&await page.locator("#finalAnswer img").count()===0&&!alerted,"answer URLs become safe links and HTML in model output stays inert");
    ok(await page.locator("#verificationPanel .verifyGroup.unverified li").count()===1,"verification panel lists UNVERIFIED claims");
    ok(errors.length===0,"no JavaScript errors during a God Mode run");
    // Reload while a job was running + server lost it (isolate restart):
    // the saved payload is resubmitted ONCE with the same clientRequestId.
    const rp=await ctx.newPage();await rp.goto(base+"/");await rp.waitForTimeout(300);
    await rp.evaluate(async()=>{
      localStorage.setItem("ai_bridge_pending_job",JSON.stringify({clientRequestId:"stale-reload",jobId:null,createdAt:Date.now(),prompt:"lost question",mode:"auto"}));
      await new Promise((res,rej)=>{const r=indexedDB.open("AI_Bridge_Pending",1);r.onupgradeneeded=()=>r.result.createObjectStore("p");r.onsuccess=()=>{const tx=r.result.transaction("p","readwrite");tx.objectStore("p").put({raw:JSON.stringify({prompt:"lost question",mode:"auto"}),savedAt:Date.now()},"stale-reload");tx.oncomplete=res;tx.onerror=rej};r.onerror=rej});
    });
    await rp.reload();
    await rp.waitForFunction(()=>document.getElementById("finalAnswer")?.textContent.includes("RECOVERED AFTER ISOLATE RESTART"),null,{timeout:15000});
    ok(resubmits.get("stale-reload")==="lost question","after reload a lost/stale job is resubmitted once with the saved payload and same clientRequestId");
    ok(await rp.evaluate(()=>localStorage.getItem("ai_bridge_pending_job"))===null,"recovered job clears its pending marker");
    await rp.close();
    const wp=await ctx.newPage(),werr=[];wp.on("pageerror",e=>werr.push(e.message));
    await wp.goto(base+"/work/");await wp.waitForTimeout(400);
    const st=()=>wp.evaluate(()=>Object.fromEntries(["runFreeTeam","pauseBtn","resumeBtn","stopBtn","reconnectBtn"].map(id=>[id,!document.getElementById(id).disabled])));
    let s=await st();ok(s.runFreeTeam&&!s.pauseBtn&&!s.resumeBtn&&!s.stopBtn,"idle Work Controller enables only Run");
    await wp.fill("#workTask","review");await wp.click("#runFreeTeam");await wp.waitForTimeout(700);
    s=await st();ok(!s.runFreeTeam&&s.pauseBtn&&s.stopBtn,"running Work Controller enables Pause and Stop");
    await wp.click("#pauseBtn");await wp.waitForTimeout(500);
    s=await st();ok(s.resumeBtn&&s.reconnectBtn&&!s.pauseBtn,"Pause detaches and enables Resume/Reconnect");
    await wp.click("#resumeBtn");await wp.waitForFunction(()=>document.getElementById("finalText").textContent.includes("RESUMED SYNTHESIS"),null,{timeout:8000});
    ok(true,"Resume reconnects to the server jobs and completes synthesis");
    await wp.fill("#workTask","again");await wp.click("#runFreeTeam");await wp.waitForTimeout(500);await wp.click("#stopBtn");await wp.waitForTimeout(700);
    s=await st();ok(s.runFreeTeam&&!s.stopBtn&&(await wp.textContent("#finalText")).length>0,"Stop ends the run and re-enables Run");
    ok(werr.length===0,"no JavaScript errors in Work Controller controls");
  }finally{await browser.close();server.close()}
}
console.log(`AI Bridge v5.8.0 UI tests passed (${passed} assertions${skipped?`, ${skipped} live group skipped`:""}).`);
