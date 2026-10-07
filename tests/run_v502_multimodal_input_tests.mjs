import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const meta=JSON.parse(read("bridge-version.json"));
ok(/^5\.(?:[1-9]\d*\.\d+|0\.(?:[2-9]|\d{2,}))$/.test(meta.version),"release is v5.0.2 or later");
const index=read("index.html"),app=read("app.js"),css=read("styles.css"),worker=read("_worker.js");
ok(index.includes('id="cameraBtn"')&&index.includes('id="cameraInput"')&&index.includes('capture="environment"'),"main composer can launch the rear camera on mobile");
ok(index.includes('id="photoBtn"')&&index.includes('id="photoInput"')&&index.includes('accept="image/*" multiple'),"main composer can attach existing photos");
ok(index.includes('id="voiceBtn"')&&index.includes('id="voiceStatus"'),"main composer exposes voice input with live status");
ok(app.includes('window.SpeechRecognition||window.webkitSpeechRecognition')&&app.includes('rec.interimResults=true')&&app.includes('input.dispatchEvent(new Event("input"'),"voice control transcribes speech into the task field instead of auto-sending");
ok(app.includes('prepareImageAttachment')&&app.includes('IMAGE_MAX_EDGE=1800')&&app.includes('image/jpeg'),"photos are resized/compressed on-device before upload");
ok(app.includes('images:submittedImages.map(({name,mime,data})=>({name,mime,data}))'),"submitted task payload includes prepared image data");
ok(css.includes('.composerToolBtn.listening')&&css.includes('@keyframes voicePulse')&&css.includes('.imagePreviewCard'),"voice/photo controls have clear active and preview states");
ok(worker.includes('const VISION_PROVIDER_IDS=["gemini","openai","claude","grok"]'),"image tasks are restricted to known vision-capable providers");
ok(worker.includes('type:"input_image"')&&worker.includes('type:"image",source:{type:"base64"')&&worker.includes('inlineData:{mimeType:img.mime,data:img.data}')&&worker.includes('type:"image_url"'),"OpenAI, Claude, Gemini, and Grok receive native multimodal payloads");
const mod=await import(pathToFileURL(path.join(root,"_worker.js")).href+`?t=${Date.now()}`);
const tiny="AQIDBA==";
const imgs=mod.safeImages([{name:"photo.jpg",mime:"image/jpeg",data:tiny}]);
ok(imgs.length===1&&imgs[0].mime==="image/jpeg"&&imgs[0].data===tiny,"server accepts a bounded valid image payload");
let bad=false;try{mod.safeImages([{name:"x.svg",mime:"image/svg+xml",data:tiny}])}catch(e){bad=Number(e.status)===400}
ok(bad,"server rejects unsupported image MIME types");
let tooMany=false;try{mod.safeImages(Array.from({length:5},(_,i)=>({name:`${i}.jpg`,mime:"image/jpeg",data:tiny})))}catch(e){tooMany=Number(e.status)===413}
ok(tooMany,"server enforces the image-count limit");

const originalFetch=globalThis.fetch;
const env={OPENAI_API_KEY:"o",ANTHROPIC_API_KEY:"c",GOOGLE_API_KEY:"g",XAI_API_KEY:"x"};
try{
  let captured=null;
  globalThis.fetch=async(url,opts={})=>{captured=JSON.parse(opts.body);return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"vision ok"}]}}]}),{status:200,headers:{"Content-Type":"application/json"}})};
  await mod.callGemini(env,"sys","describe",null,null,imgs);
  ok(captured.contents[0].parts.some(x=>x.inlineData?.data===tiny),"Gemini runtime request includes inline image data");

  globalThis.fetch=async(url,opts={})=>{captured=JSON.parse(opts.body);return new Response(JSON.stringify({output_text:"vision ok"}),{status:200,headers:{"Content-Type":"application/json"}})};
  await mod.callOpenAI(env,"sys","describe",null,null,imgs);
  ok(captured.input[0].content.some(x=>x.type==="input_image"&&x.image_url.includes(tiny)),"OpenAI runtime request includes input_image data URL");

  globalThis.fetch=async(url,opts={})=>{captured=JSON.parse(opts.body);return new Response(JSON.stringify({content:[{type:"text",text:"vision ok"}]}),{status:200,headers:{"Content-Type":"application/json"}})};
  await mod.callClaude(env,"sys","describe",null,null,imgs);
  ok(captured.messages[0].content.some(x=>x.type==="image"&&x.source?.data===tiny),"Claude runtime request includes base64 image block");

  globalThis.fetch=async(url,opts={})=>{captured=JSON.parse(opts.body);return new Response(JSON.stringify({choices:[{message:{content:"vision ok"}}]}),{status:200,headers:{"Content-Type":"application/json"}})};
  await mod.callGrok(env,"sys","describe",null,null,imgs);
  ok(captured.messages[1].content.some(x=>x.type==="image_url"&&x.image_url?.url.includes(tiny)),"Grok runtime request includes image_url data URL");
} finally { globalThis.fetch=originalFetch; }

console.log("AI Bridge v5.0.2 multimodal input tests passed.");
