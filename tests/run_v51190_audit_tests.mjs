/* v5.11.90: аудит-виправлення — області видимості в app.js, переклади, приватність маршрутів і файлів. */
import fs from "node:fs";import path from "node:path";import vm from "node:vm";import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),i18n=fs.readFileSync(path.join(root,"i18n.js"),"utf8"),css=fs.readFileSync(path.join(root,"styles.css"),"utf8");
// 1. блок кнопки «Вниз» має бути всередині головної функції застосунку (інакше ReferenceError на кожен скрол)
const fabInit=app.lastIndexOf('const b=document.getElementById("scrollFab")'),lastClose=app.lastIndexOf("})();");
ok(fabInit>0&&app.slice(fabInit,lastClose).includes("})();"),"scroll-FAB init is nested inside the main app scope (its own IIFE closes before the app's)");
ok(app.trimEnd().endsWith("})();\n})();")||/\}\)\(\);\s*\}\)\(\);\s*$/.test(app),"app.js ends with the FAB IIFE followed by the app IIFE close");
// 2. markSendOutcome/setSendState — на рівні модуля, не всередині setBusy
const sb=app.indexOf("function setBusy(v){"),mso=app.indexOf("function markSendOutcome("),sss=app.indexOf("function setSendState(");
ok(mso>0&&sss>0&&mso<sb&&sss<sb,"markSendOutcome and setSendState are declared before setBusy (module scope), so error paths can call them");
const sbBody=app.slice(sb,app.indexOf("\nfunction ",sb+10));
ok(!/function markSendOutcome|addEventListener\("aibridge:languagechange"/.test(sbBody),"setBusy no longer redeclares them or adds a language listener on every call");
// 3. дрібні помилки
ok(!/toLocaleString\(locale\(\)/.test(app),"noteFmtDate no longer calls an undefined locale()");
ok(!/SMART_REPLY_CACHE=\{/.test(app.replace("const SMART_REPLY_CACHE={","")),"SMART_REPLY_CACHE (a const) is mutated, not reassigned");
ok(!/typeof getLanguage==="function"/.test(app),"UI language comes from I18N.getLanguage(), not an undefined global");
// 4. переклади: рядки з LANGUAGES доливаються в пакети; 4 відсутні ключі додано
const sandbox={globalThis:{},document:{documentElement:{},querySelectorAll:()=>[],getElementById:()=>null},localStorage:{getItem:()=>"en",setItem(){}},navigator:{language:"en"},window:{dispatchEvent(){}},CustomEvent:function(){}};sandbox.globalThis=sandbox;
vm.runInNewContext(i18n,sandbox);const I=sandbox.AIBridgeI18n;I.setLanguage("en");
for(const k of ["dtcTitle","dtcFind","navDtc","copyRich","scrollFabLabel","exportPickPlace","exportPickPlaceDesc"])ok(I.t(k)!==k,`English text exists for ${k}`);
I.setLanguage("ru");ok(I.t("copyRich")!=="copyRich"&&I.t("dtcTitle")!=="dtcTitle","Russian falls back to real text, never a raw key");
// 5. верстка шапки на iPhone
ok(/\.chatTopbar \.brand\{flex:0 0 auto\}/.test(css)&&/@media\(max-width:430px\)\{[^}]*\n?[^}]*#miniProviderStatus\{display:none\}/.test(css.replace(/\/\*[^*]*\*\//g,"")),"phone header: brand does not shrink under the status pill; provider dots hidden ≤430px");
// 6. сервер: приватні маршрути і файли
const tmp=path.join(root,"tests",`worker-v51190-${Date.now()}.mjs`);fs.copyFileSync(path.join(root,"_worker.js"),tmp);
try{
  const m=await import(pathToFileURL(tmp).href);
  for(const p of ["/STATUS.md","/DESIGN.md","/TEAM_CONTRACT.md","/scheduler-worker/wrangler.toml","/backtests/a.json","/.wrangler/cache/wrangler-account.json","/.env"])ok(m.isInternalAssetPath(p),`${p} is not served publicly`);
  for(const p of ["/","/index.html","/app.js","/core.js","/changelog-app.json","/.well-known/oauth-authorization-server","/404.html","/robots.txt","/vendor/pdfjs/pdf.mjs"])ok(!m.isInternalAssetPath(p),`${p} stays public`);
  const env={BRIDGE_ACCESS_TOKEN:"tok-tok-tok-tok-tok-tok",ASSETS:{fetch:async()=>new Response("x")}};
  for(const [method,p] of [["GET","/api/lotto/analyze"],["POST","/api/lotto/refresh"],["GET","/api/lotto/draws"],["GET","/api/dtc/lookup?code=P0300"],["GET","/api/dtc/vin?vin=1HGCM82633A004352"]]){
    const r=await m.default.fetch(new Request("https://x.test"+p,{method,headers:{"content-type":"application/json"},body:method==="GET"?undefined:"{}"}),env,{waitUntil(){}});
    ok(r.status===401,`${method} ${p.split("?")[0]} requires the owner's login`);
  }
  const r=await m.default.fetch(new Request("https://x.test/api/dtc/stats",{headers:{authorization:"Bearer tok-tok-tok-tok-tok-tok"}}),env,{waitUntil(){}});
  ok(r.status===200,"the same route works for the logged-in owner");
}finally{fs.rmSync(tmp,{force:true})}
console.log("v5.11.90 audit tests PASS");
