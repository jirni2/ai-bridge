import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import assert from "node:assert/strict";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const src=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const tmp=path.join(here,`worker-v489-${Date.now()}.mjs`);
fs.writeFileSync(tmp,src);
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);

try{
  const raw=[
    {claim:"sameOriginMutation permits requests lacking an Origin header to bypass cross-origin checks",kind:"risk",verdict:"uncertain",quote_matched:false,verification_reason:"insufficient evidence"},
    {claim:"Authentication comparison uses a constant-time XOR loop to mitigate timing attacks",verdict:"uncertain",quote_matched:false,verification_reason:"not a defect"},
    {claim:"The Content Security Policy allows unsafe-inline styles",kind:"risk",verdict:"uncertain",quote_matched:false,verification_reason:"needs verification"},
    {claim:"Provider vault key derivation uses single-iteration SHA-256 rather than HKDF or PBKDF",verdict:"uncertain",quote_matched:false,verification_reason:"needs verification"},
    {claim:"Session cookies are protected by HttpOnly, Secure, and SameSite=Strict flags",verdict:"uncertain",quote_matched:false,verification_reason:"positive control"}
  ].map(x=>({...m.sanitizeJudgeFinding(x),quote_matched:x.quote_matched,verification_reason:x.verification_reason,deterministically_rejected:false}));

  assert.equal(raw[1].kind,"positive","constant-time mitigation should be informational/positive when no defect is claimed");
  assert.equal(raw[3].kind,"defect","single-iteration/KDF wording should be treated as a possible defect when kind is omitted");
  assert.equal(raw[4].kind,"positive","secure cookie flags should not become a defect");
  const stats=m.evidenceAuditStats(raw);
  assert.equal(stats.actionable.length,3);
  assert.equal(stats.informational.length,2);
  const rendered=m.formatEvidenceSynthesis(raw,"Проведи аудит коду і знайди вразливості");
  assert.match(rendered,/Підтверджених дефектів або вразливостей[^]*не знайдено/i);
  assert.match(rendered,/3 гіпотези/i);
  assert.match(rendered,/Позитивних або нейтральних спостережень[^]*2/i);
  for(const f of raw)assert.doesNotMatch(rendered,new RegExp(f.claim.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i"),"unverified/positive claim text must not be dumped into the user-facing final report");

  const confirmed=[{
    ...m.sanitizeJudgeFinding({claim:"CSRF check accepts a missing Origin header on a mutating browser endpoint",kind:"defect",verdict:"supported",file:"_worker.js",symbol:"sameOriginMutation",code_evidence:"  if(!origin)return true;",confidence:"high",verification_reason:"The exact source line accepts a missing Origin."}),
    quote_matched:true,start_line:20,end_line:20,deterministically_rejected:false
  },{
    ...m.sanitizeJudgeFinding({claim:"Session cookies are protected by HttpOnly, Secure, and SameSite=Strict flags",kind:"positive",verdict:"supported",file:"_worker.js",code_evidence:"  return cookie;",confidence:"high",verification_reason:"Positive control."}),
    quote_matched:true,start_line:30,end_line:30,deterministically_rejected:false
  }];
  const confirmedText=m.formatEvidenceSynthesis(confirmed,"Проведи аудит");
  assert.match(confirmedText,/Підтверджено дефектів\/ризиків: 1/i);
  assert.match(confirmedText,/CSRF check accepts a missing Origin header/i);
  assert.doesNotMatch(confirmedText,/Session cookies are protected/i,"positive controls must not appear under confirmed defect findings");

  // End-to-end screenshot regression: five unverified claims from the Judge must
  // not become a giant scary list in the final user-facing answer.
  const auth="bridge-secret-token";
  const fileContext=`<attached_files>\n<file path="_worker.js">\nfunction sameOriginMutation(req){\n  const origin=req.headers.get("origin");\n  if(!origin)return true;\n}\nfunction safeCompare(){ return true; }\n</file>\n</attached_files>`;
  const request=new Request("https://bridge.example/api/run",{method:"POST",headers:{Authorization:`Bearer ${auth}`,"Content-Type":"application/json"},body:JSON.stringify({prompt:"Проведи аудит коду і знайди вразливості",displayPrompt:"Проведи аудит коду і знайди вразливості",fileContext,mode:"auto",synthesize:true})});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (url,opts={})=>{
    const u=String(url),body=JSON.parse(opts.body||"{}");
    if(u.includes("generativelanguage.googleapis.com")){
      if(body.generationConfig?.responseMimeType==="application/json"){
        const payload={summary:"audit",findings:raw.map(f=>({claim:f.claim,file:"_worker.js",symbol:"",code_evidence:"",confidence:"low",kind:f.kind,verdict:"uncertain",verification_reason:"not enough exact source evidence"}))};
        return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(payload)}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
      }
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"I found several possible security issues that need verification."}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    if(u.includes("openrouter.ai"))return new Response(JSON.stringify({choices:[{message:{content:"Several hypotheses should be checked, but I cannot confirm them from the available excerpts."}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    throw new Error("unexpected URL "+u);
  };
  const env={BRIDGE_ACCESS_TOKEN:auth,GOOGLE_API_KEY:"g",OPENROUTER_API_KEY:"r",ASSETS:{fetch:async()=>new Response("asset")}};
  try{
    const res=await m.default.fetch(request,env),body=await res.json();
    assert.equal(res.status,200);
    assert.equal(body.meta?.verifiedFileAudit,true);
    assert.match(body.final,/Підтверджених дефектів або вразливостей[^]*не знайдено/i);
    assert.doesNotMatch(body.final,/sameOriginMutation permits/i);
    assert.doesNotMatch(body.final,/Session cookies are protected/i);
  } finally { globalThis.fetch=originalFetch; }
} finally {
  try{fs.unlinkSync(tmp)}catch{}
}
console.log("AI Bridge v4.8.9 audit UX regression tests passed");
