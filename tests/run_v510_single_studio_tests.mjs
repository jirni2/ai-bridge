import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const meta=JSON.parse(read("bridge-version.json")),html=read("index.html"),app=read("app.js"),css=read("styles.css"),worker=read("_worker.js"),i18n=read("i18n.js");
ok(/^5\.(?:[1-9]|[1-9][0-9])\.[0-9]+$/.test(meta.version),"release remains compatible with v5.1+ features");
ok(html.includes('id="page-studio"')&&html.includes('data-page="studio"')&&html.includes('data-i18n="navStudio"'),"AI Studio has a real navigation page");
ok(html.includes('data-studio-mode="photo-edit"')&&html.includes('data-studio-mode="animate"')&&html.includes('data-studio-mode="video-edit"'),"Studio exposes photo edit, photo animation, and video edit modes");
ok(html.includes('data-token-card="fal"')&&html.includes('placeholder="FAL_KEY"'),"Connections can store a fal.ai key");
ok(css.includes('.studioModeGrid')&&css.includes('.studioResult')&&css.includes('.singlePick'),"Single AI and Studio have dedicated responsive styling");
ok(app.includes('name="singleProvider"')&&app.includes('ai_bridge_single_provider'),"Single AI uses a persisted radio selection instead of team checkboxes");
ok(worker.includes('Single AI mode requires exactly one configured provider.'),"Worker enforces exact one-provider Single AI mode");
ok(worker.includes('/api/media/submit')&&worker.includes('/api/media/status'),"Worker exposes authenticated Studio queue routes");
ok(worker.includes('fal-ai/nano-banana-2/edit')&&worker.includes('fal-ai/pika/v2.2/image-to-video')&&worker.includes('fal-ai/wan/v2.7/edit-video'),"Studio endpoints are explicitly allowlisted");
ok(worker.includes('camera=(self)')&&worker.includes('microphone=(self)'),"same-origin camera and voice features are allowed by Permissions-Policy");
ok(i18n.includes('studioTitle:"AI Studio"')&&i18n.includes('navStudio:"Студія"'),"Studio participates in multilingual UI");

const mod=await import(pathToFileURL(path.join(root,"_worker.js")).href+`?t=${Date.now()}`);
ok(mod.providerErrorKind({status:429,message:'credit_balance_exhausted: You have no credits remaining'})==="billing_or_quota","OpenAI exhausted-credit 429 is classified as billing/quota");
ok(mod.providerErrorKind({status:400,message:'Your credit balance is too low to access the Anthropic API'})==="billing_or_quota","Claude low-balance 400 is classified as billing/quota");
ok(mod.providerErrorKind({status:429,message:'Quota exceeded. Please retry in 59 seconds'})==="rate_limited","temporary Gemini 429 remains a rate limit");

const img={name:"x.jpg",mime:"image/jpeg",dataUrl:"data:image/jpeg;base64,AQID"};
const vid={name:"x.mp4",mime:"video/mp4",dataUrl:"data:video/mp4;base64,AQID"};
let input=mod.falInputFor("photo-edit","remove background",img,"high");
ok(input.image_urls?.[0]===img.dataUrl&&input.resolution==="2K","Photo AI maps to Nano Banana edit with bounded data URI and high resolution");
input=mod.falInputFor("animate","gentle camera movement",img,"standard");
ok(input.image_url===img.dataUrl&&input.duration===5&&input.resolution==="720p","Animate Photo maps to Pika image-to-video");
input=mod.falInputFor("video-edit","make it cinematic",vid,"high");
ok(input.video_url===vid.dataUrl&&input.audio_setting==="origin"&&input.duration===0&&input.resolution==="1080p","Video Edit maps to Wan edit-video while preserving original audio");

// Exact Single AI: selecting OpenRouter must not silently call Gemini/Groq.
// M3 (v5.11.9 wave 2): поведінка навмисно змінилась — після відповіді Bridge
// робить ОДИН обмежений виклик Judge з рубрикою; у single-режимі суддя —
// ТА САМА явно обрана модель (самооцінка, answer_to_score у тілі), повтору
// іншою моделлю немає. Намір тесту збережено й посилено: жоден виклик не йде
// до іншого провайдера.
const originalFetch=globalThis.fetch;const calls=[];
globalThis.fetch=async(url,opts={})=>{const body=String(opts?.body||"");const judge=body.includes("answer_to_score");calls.push({url:String(url),judge});const text=judge?'{"accuracy":5,"completeness":5,"language":5,"sources":5}':"openrouter exact single answer";return new Response(JSON.stringify({choices:[{message:{content:text}}]}),{status:200,headers:{"Content-Type":"application/json"}})};
try{
  const env={OPENROUTER_API_KEY:"r",GOOGLE_API_KEY:"g",GROQ_API_KEY:"q"};
  const out=await mod.runTeam(env,{prompt:"hello there",mode:"single",providers:["openrouter"],synthesize:false});
  ok(out.selectedProviders?.join(",")==="openrouter"&&calls.length===2&&calls.every(c=>c.url.includes("openrouter.ai"))&&calls.filter(c=>c.judge).length===1&&out.meta.qualityScore?.avg===5,"Single AI calls only the chosen provider (+ one bounded M3 self-judge call to the same provider)");
  let rejected=false;try{await mod.runTeam(env,{prompt:"hello",mode:"single",providers:[],synthesize:false})}catch(e){rejected=Number(e.status)===400}
  ok(rejected,"Single AI rejects an empty choice instead of auto-substituting a provider");
  rejected=false;try{await mod.runTeam(env,{prompt:"describe",mode:"single",providers:["openrouter"],images:[{name:"x.jpg",mime:"image/jpeg",data:"AQID"}],synthesize:false})}catch(e){rejected=Number(e.status)===400}
  ok(rejected,"Single AI does not silently replace a non-vision selection for photo input");
} finally {globalThis.fetch=originalFetch}

// Media submit is server-side, authenticated, endpoint-allowlisted, and never returns FAL_KEY.
let captured=null;globalThis.fetch=async(url,opts={})=>{captured={url:String(url),opts};return new Response(JSON.stringify({request_id:"764cabcf-b745-4b3e-ae38-1200304cf45b",status:"IN_QUEUE"}),{status:200,headers:{"Content-Type":"application/json"}})};
try{
  const env={BRIDGE_ACCESS_TOKEN:"bridge-secret",FAL_KEY:"fal-secret"};
  const req=new Request("https://bridge.example/api/media/submit",{method:"POST",headers:{Authorization:"Bearer bridge-secret","Content-Type":"application/json"},body:JSON.stringify({action:"photo-generate",prompt:"blue tractor at sunset",quality:"standard",allowPaidFallback:true})});
  const res=await mod.handleMediaSubmit(req,env),body=await res.json();
  ok(res.status===200&&body.requestId&&captured.url==="https://queue.fal.run/fal-ai/nano-banana-2","Studio submit uses only the allowlisted fal queue endpoint");
  ok(captured.opts.headers.Authorization==="Key fal-secret"&&!JSON.stringify(body).includes("fal-secret"),"FAL_KEY stays server-side");
} finally {globalThis.fetch=originalFetch}
console.log("AI Bridge v5.1.x Single AI + Studio tests passed.");
