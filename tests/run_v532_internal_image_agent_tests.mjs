import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const ok=(v,m)=>{if(!v)throw new Error("FAIL: "+m);console.log("✓",m)};
const meta=JSON.parse(read("bridge-version.json"));
ok(/^5\.(?:3\.(?:[7-9]|[1-9][0-9]+)|[4-9]\.[0-9]+|[1-9][0-9]+\.[0-9]+)$/.test(meta.version),"release version is v5.3.7 or newer");
const worker=read("_worker.js"),app=read("app.js"),html=read("index.html"),i18n=read("i18n.js");
ok(worker.includes('"generate_image"')&&worker.includes('runAgentInternalImage'),"Agent Core has an internal image-generation tool");
ok(worker.includes('Use generate_image only when the capability observation says image generation is available'),"Agent checks image-engine capability before requesting generation");
ok(html.includes('data-i18n="agentCapImage"'),"Agent UI advertises native image generation");
ok(app.includes('renderAgentArtifacts')&&app.includes('artifacts:j.artifacts||[]'),"Agent chat renders generated image artifacts");
ok(app.includes('map(({artifacts,...m})=>m)'),"large generated image data is not persisted into Agent localStorage memory");
ok(i18n.includes('agentPhase_generating_image')&&i18n.includes('agentTrace_generate_image'),"image generation has visible Agent progress and trace labels");
const mod=await import(pathToFileURL(path.join(root,"_worker.js")).href+`?t=${Date.now()}`);
const action=mod.parseAgentAction('{"action":"generate_image","prompt":"a red tractor at sunset","aspect":"landscape"}');
ok(action?.action==="generate_image"&&action.aspect==="landscape","Agent action parser accepts generate_image");
let coreCalls=0,imageCalls=0,helperFetches=0;
const env={AI:{async run(model,payload){
  if(String(model).includes('flux-2-klein-4b')){imageCalls++;ok(!!payload?.multipart,"image generation uses Workers AI binding multipart input");return {image:"aGVsbG8="}}
  coreCalls++;
  if(coreCalls===1)return {response:'{"action":"generate_image","prompt":"a red tractor at sunset","aspect":"landscape","purpose":"user asked for an image"}'};
  return {response:'{"action":"finish","answer":"Готово — я згенерував фото сам через внутрішній image engine."}'};
}}};
const oldFetch=globalThis.fetch;globalThis.fetch=async(...args)=>{helperFetches++;return oldFetch(...args)};
try{
  const result=await mod.runAgent(env,{task:"Згенеруй фото червоного трактора на заході сонця",providerPrompt:"Згенеруй фото червоного трактора на заході сонця",providerIds:[],maxSteps:3});
  ok(result.artifacts?.length===1&&result.artifacts[0].type==="image","Agent returns the generated image as an artifact");
  ok(result.artifacts[0].dataUrl==="data:image/jpeg;base64,aGVsbG8=","image artifact contains the internal engine output");
  ok(result.meta?.imageGenerations===1,"Agent reports one native image generation");
  ok(imageCalls===1&&helperFetches===0,"image generation required no external helper provider/service call");
} finally {globalThis.fetch=oldFetch}
console.log("AI Bridge v5.3.6 internal image Agent regression tests passed.");
