import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import assert from "node:assert/strict";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const src=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const tmp=path.join(here,`worker-v487-${Date.now()}.mjs`);
fs.writeFileSync(tmp,src);
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const auth="bridge-secret-token";
const req=body=>new Request("https://bridge.example/api/run",{method:"POST",headers:{Authorization:`Bearer ${auth}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
const source=`if(e.request.method!=="GET")return;\nconst u=new URL(e.request.url);\nconst sensitive=u.pathname.startsWith("/api/")||u.pathname.startsWith("/oauth/")||u.pathname.startsWith("/.well-known/")||u.pathname==="/mcp";\nif(sensitive){e.respondWith(fetch(e.request));return}\ne.respondWith(fetch(e.request).then(r=>{\nconst cc=(r.headers.get("cache-control")||"").toLowerCase();\nif(r.ok&&!cc.includes("no-store")){ cache.put(e.request,r.clone()); }\nreturn r;\n}));`;
const fileContext=`<attached_files>\n<file path="sw.js">\n${source}\n</file>\n</attached_files>`;
const originalFetch=globalThis.fetch;
try{
  // Production regression: first provider response is just a source dump from sw.js.
  // Bridge must NOT show it as the final answer. It gets one repair attempt.
  // M3 (v5.11.9 wave 2): поведінка навмисно змінилась — після відремонтованої
  // відповіді Bridge робить ОДИН обмежений виклик Judge з рубрикою
  // (answer_to_score у промпті). Намір тесту збережено: ремонтна спроба рівно одна.
  let calls=0,judgeCalls=0,lastUserPrompt="";
  globalThis.fetch=async (url,opts={})=>{
    if(!String(url).includes("generativelanguage.googleapis.com"))throw new Error("unexpected URL "+url);
    const body=JSON.parse(opts.body);const userText=body.contents?.[0]?.parts?.[0]?.text||"";
    if(userText.includes("answer_to_score")){judgeCalls++;return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"accuracy":5,"completeness":5,"language":5,"sources":5}'}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});}
    calls++;lastUserPrompt=userText;
    const text=calls===1?source:"Знайдено проблему в Service Worker: не кешуйте чутливі маршрути та відповіді з no-store. Завдання виконано як аудит, а не як копіювання sw.js.";
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  let env={BRIDGE_ACCESS_TOKEN:auth,GOOGLE_API_KEY:"g",ASSETS:{fetch:async()=>new Response("asset")}};
  let res=await m.default.fetch(req({prompt:"Проведи аудит ZIP і скажи, що треба виправити.",displayPrompt:"Проведи аудит ZIP і скажи, що треба виправити.",fileContext,mode:"auto",synthesize:false}),env);
  let body=await res.json();
  assert.equal(res.status,200);
  assert.ok(!body.final.startsWith("if(e.request.method"),"raw sw.js dump must not become the final answer");
  assert.match(body.final,/Service Worker/i);
  assert.equal(calls,2,"raw dump should trigger exactly one automatic repair attempt");
  assert.equal(judgeCalls,1,"repaired answer gets one bounded M3 quality-judge call");
  assert.equal(body.results?.[0]?.fileAnswerRetried,true,"metadata records the repair attempt");
  assert.ok(lastUserPrompt.includes('<user_task priority="highest">'),"file task is explicitly separated as authoritative user task");
  assert.ok(lastUserPrompt.includes("<bridge_response_contract>"),"file response contract is sent to provider");

  // If the provider repeats a raw dump after repair, reject it instead of displaying it.
  calls=0;
  globalThis.fetch=async (url,opts={})=>{
    calls++;
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:source}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  res=await m.default.fetch(req({prompt:"Проаналізуй файл і дай висновок.",displayPrompt:"Проаналізуй файл і дай висновок.",fileContext,mode:"auto",synthesize:false}),env);
  body=await res.json();
  assert.equal(res.status,502);
  assert.equal(body.results?.[0]?.errorKind,"invalid_file_answer");
  assert.equal(calls,2);

  // Explicit request for exact source must still be allowed.
  // M3: Judge-виклик тут теж один, відповідь явно просили — повтору немає.
  calls=0;judgeCalls=0;
  globalThis.fetch=async(url,opts={})=>{
    const userText=String(JSON.parse(opts.body).contents?.[0]?.parts?.[0]?.text||"");
    if(userText.includes("answer_to_score")){judgeCalls++;return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"accuracy":5,"completeness":5,"language":5,"sources":5}'}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});}
    calls++;
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:source}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  res=await m.default.fetch(req({prompt:"Покажи повний код файлу sw.js.",displayPrompt:"Покажи повний код файлу sw.js.",fileContext,mode:"auto",synthesize:false}),env);
  body=await res.json();
  assert.equal(res.status,200);
  assert.equal(body.final,source);
  assert.equal(calls,1,"explicit source request must not be needlessly retried");
  assert.equal(judgeCalls,1,"explicit source request gets one bounded M3 quality-judge call");

  // Client must send task and file context as separate fields.
  const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
  assert.ok(app.includes("const payload={prompt,displayPrompt:prompt,fileContext:context,images:submittedImages.map(({name,mime,data})=>({name,mime,data})),mode,providers,synthesize,judge,"));
  assert.ok(app.includes('searchFirst:$("searchFirst")?.checked!==false,clientRequestId,effort:getEffort()}'),"Search First preference is a separate field and does not merge task/file context");
  assert.ok(app.includes("await streamingRunRequest(payload,setState)"));
  assert.ok(!app.includes("const context=buildFileContext(),fullPrompt=prompt+context"));

  const appSrc=fs.readFileSync(path.join(root,"app.js"),"utf8");
  assert.ok(appSrc.includes('(?:file|attached_files|user_task|bridge_response_contract|bridge_retry|original_task|peer_answers|verification_context)'),"client neutralizes nested Bridge control tags inside source files");
  assert.ok(src.includes('inner=inner.replace(/<(\\/?(?:attached_files|user_task|bridge_response_contract|bridge_retry|original_task|peer_answers|verification_context)'),"server neutralizes nested control envelopes from legacy clients");
} finally {
  globalThis.fetch=originalFetch;
  try{fs.unlinkSync(tmp)}catch{}
}
console.log("AI Bridge v4.8.7 file-task priority regression tests passed");
