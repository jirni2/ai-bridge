/* v5.11.93 — аудит застосунку: стійкість API до некоректних тіл, дрібні помилки клієнта. */
import fs from "node:fs";import path from "node:path";import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),crew=fs.readFileSync(path.join(root,"crew.js"),"utf8");
ok(!/typeof showPage==="function"/.test(crew)&&/data-page="connections"/.test(crew),"crew.js: кнопка «До авторизації» перемикає сторінку через вкладку (showPage звідти недоступна)");
ok(/if\(r&&r\.truncated\)final\+=/.test(app)&&!/if\(r&&r\.partial\)final\+=/.test(app),"примітка «аналіз частковий» — лише коли ядро справді не обробило весь текст");
ok(/lottoBall sm">\$\{esc\(x\)\}/.test(app)&&/<img src="\$\{esc\(c\.thumb\)\}"/.test(app),"значення з сервера екрануються перед вставкою в сторінку");
const tmp=path.join(root,"tests",`worker-v51193-${Date.now()}.mjs`);fs.copyFileSync(path.join(root,"_worker.js"),tmp);
const orig=globalThis.fetch;globalThis.fetch=async()=>{throw new Error("no network")};
try{
  const m=await import(pathToFileURL(tmp).href);
  const kv={get:async()=>null,put:async()=>{},delete:async()=>{},list:async()=>({keys:[]})};
  const env={BRIDGE_ACCESS_TOKEN:"tok-tok-tok-tok-tok-tok-tok",AI_BRIDGE_JOBS:kv,ASSETS:{fetch:async()=>new Response("x")}};
  const call=(p,method="POST",body="null",ct="application/json")=>m.default.fetch(new Request("https://x.test"+p,{method,headers:{"content-type":ct,authorization:"Bearer tok-tok-tok-tok-tok-tok-tok",origin:"https://x.test"},body:method==="GET"?undefined:body}),env,{waitUntil(){}});
  for(const p of ["/api/session/login","/api/provider-tokens","/api/diagnostics/providers","/api/media/submit","/api/work/run","/api/work/provider","/api/work/synthesize","/api/lotto/check","/api/run","/api/history","/api/feedback"]){
    let st;try{st=(await call(p)).status}catch(e){st="THROW "+e.message}
    ok(typeof st==="number"&&st<500,`${p}: тіло «null» → ${st}, а не виняток/500`);
  }
  for(const g of ["__proto__","constructor","toString"]){const r=await call("/api/lotto/draws?game="+g,"GET");ok(r.status===400,`лото: game=${g} → 400`)}
  for(const p of ["/oauth/token","/oauth/authorize"]){let st;try{st=(await call(p,"POST","{}")).status}catch(e){st="THROW"}ok(st===400,`${p}: JSON замість форми → 400`)}
  ok((await call("/api/history","POST",'{"items":[]}')).status===200,"коректне тіло працює як раніше");
}finally{globalThis.fetch=orig;fs.rmSync(tmp,{force:true})}
console.log("v5.11.93 audit tests PASS");
