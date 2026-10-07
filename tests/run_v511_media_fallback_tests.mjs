import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const meta=JSON.parse(read("bridge-version.json")),app=read("app.js"),worker=read("_worker.js"),html=read("index.html"),i18n=read("i18n.js");
ok(/^5\.(?:[1-9]|[1-9][0-9])\.[0-9]+$/.test(meta.version),"release remains compatible with v5.1+ features");
ok(worker.includes('@cf/black-forest-labs/flux-2-klein-4b'),"Workers AI FLUX.2 klein 4B is explicitly selected for image fallback");
ok(worker.includes('cloudflareAI:cloudflareAIAvailable(reqEnv)'),"status reports whether the Cloudflare AI binding is active");
ok(app.includes('cloudflareFile')&&app.includes('studioCloudflareImage'),"client prepares a bounded fallback reference image for Workers AI photo editing");
ok(app.includes('String(j.status||"").toUpperCase()==="COMPLETED"'),"Studio accepts synchronous Workers AI image results");
ok(i18n.includes('studioImageEngineCloudflare')&&i18n.includes('cloudflareAiMissing'),"fallback engine state is explained in the multilingual UI");
ok(html.includes('id="studioCostNote"'),"Studio keeps a visible engine/cost note");

const mod=await import(pathToFileURL(path.join(root,"_worker.js")).href+`?t=${Date.now()}`);
ok(mod.workersAIAvailable({AI:{run(){}}})===true&&mod.workersAIAvailable({})===false,"Workers AI binding detection is honest");

let calledModel="",multipartSeen=false;
const aiEnv={AI:{async run(model,opts){calledModel=model;multipartSeen=!!opts?.multipart?.body&&String(opts?.multipart?.contentType||"").startsWith("multipart/form-data");return {image:"AQID"}}}};
const cfResult=await mod.runCloudflareImage(aiEnv,"photo-generate","a fox in a forest",null,"standard");
ok(calledModel==='@cf/black-forest-labs/flux-2-klein-4b'&&multipartSeen,"Workers AI image generation uses multipart binding API");
ok(cfResult.image_url==="data:image/jpeg;base64,AQID"&&cfResult.source==="cloudflare-workers-ai","Workers AI output is normalized to a renderable data URI");
const editResult=await mod.runCloudflareImage(aiEnv,"photo-edit","keep the fox, change background",{name:"input.jpg",mime:"image/jpeg",dataUrl:"data:image/jpeg;base64,AQID"},"standard");
ok(editResult.source==="cloudflare-workers-ai","Workers AI photo editing accepts a bounded reference image");

const originalFetch=globalThis.fetch;
try{
  let falCalls=0;
  globalThis.fetch=async()=>{falCalls++;return new Response(JSON.stringify({request_id:"764cabcf-b745-4b3e-ae38-1200304cf45b",status:"IN_QUEUE"}),{status:200,headers:{"Content-Type":"application/json"}})};
  const env={BRIDGE_ACCESS_TOKEN:"bridge-secret",FAL_KEY:"fal-secret",AI:{async run(){return {image:"AQID"}}}};
  const req=new Request("https://bridge.example/api/media/submit",{method:"POST",headers:{Authorization:"Bearer bridge-secret","Content-Type":"application/json"},body:JSON.stringify({action:"photo-generate",prompt:"blue tractor at sunset",quality:"standard"})});
  const res=await mod.handleMediaSubmit(req,env),body=await res.json();
  ok(res.status===200&&body.status==="COMPLETED"&&body.engine==="cloudflare-workers-ai"&&falCalls===0,"Photo AI prefers free Cloudflare Workers AI before fal.ai");

  let capturedUrl="";
  globalThis.fetch=async(url)=>{capturedUrl=String(url);return new Response(JSON.stringify({request_id:"764cabcf-b745-4b3e-ae38-1200304cf45b",status:"IN_QUEUE"}),{status:200,headers:{"Content-Type":"application/json"}})};
  const fallbackEnv={BRIDGE_ACCESS_TOKEN:"bridge-secret",FAL_KEY:"fal-secret",AI:{async run(){throw Object.assign(new Error("temporary Workers AI capacity"),{status:503})}}};
  const req2=new Request("https://bridge.example/api/media/submit",{method:"POST",headers:{Authorization:"Bearer bridge-secret","Content-Type":"application/json"},body:JSON.stringify({action:"photo-generate",prompt:"red barn",quality:"standard",allowPaidFallback:true})});
  const res2=await mod.handleMediaSubmit(req2,fallbackEnv),body2=await res2.json();
  ok(res2.status===200&&body2.engine==="fal.ai"&&body2.requestId&&capturedUrl.includes("queue.fal.run"),"Photo AI can fall back to fal.ai only after explicit paid opt-in");
  ok(body2.attempts?.[0]?.engine==="cloudflare-workers-ai"&&body2.attempts?.[0]?.ok===false&&body2.attempts?.[1]?.engine==="fal.ai","fallback diagnostics retain both engine attempts");

  globalThis.fetch=async()=>new Response(JSON.stringify({detail:{message:"User is locked. Reason: Exhausted balance."}}),{status:403,headers:{"Content-Type":"application/json"}});
  const noCfEnv={BRIDGE_ACCESS_TOKEN:"bridge-secret",FAL_KEY:"fal-secret"};
  const req3=new Request("https://bridge.example/api/media/submit",{method:"POST",headers:{Authorization:"Bearer bridge-secret","Content-Type":"application/json"},body:JSON.stringify({action:"photo-generate",prompt:"fox",quality:"standard",allowPaidFallback:true})});
  const res3=await mod.handleMediaSubmit(req3,noCfEnv),body3=await res3.json();
  ok(res3.status===403&&body3.errorKind==="billing_or_quota"&&/binding named AI/i.test(body3.help||""),"fal.ai exhausted balance recommends the Cloudflare AI fallback instead of stopping silently");
} finally {globalThis.fetch=originalFetch}

console.log("AI Bridge v5.1.x media fallback tests passed.");
