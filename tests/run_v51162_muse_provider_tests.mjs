/* v5.11.62 — Muse як провайдер (чесний, без API):
   1) PROVIDERS містить muse з assistant:true.
   2) i18n ключі museProviderSub/museBadge/museNoSetup/museCardText (uk/en).
   3) _worker.js /api/status завжди повертає providers.muse=true.
   4) sendTask перехоплює вибір тільки-Muse → showMuseCard(), без API-виклику.
   5) showMuseCard НЕ імітує відповідь — чесний текст про відсутність API. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const worker=R("_worker.js"),app=R("app.js"),i18n=R("i18n.js"),css=R("styles.css");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

// 1. PROVIDERS містить muse
ok(/muse:\{name:"Muse",logo:"M"/.test(app),"app.js: PROVIDERS містить muse");
ok(/assistant:true/.test(app),"app.js: muse позначено assistant:true");

// 2. i18n ключі uk/en
for(const k of ["museProviderSub","museBadge","museNoSetup","museCardText"]){
  ok(i18n.includes(k+":"),"i18n.js: ключ "+k+" присутній");
}
ok(i18n.includes('museProviderSub:"Твій персональний асистент"'),"i18n.js: uk museProviderSub");
ok(i18n.includes('museProviderSub:"Your personal assistant"'),"i18n.js: en museProviderSub");
ok(i18n.includes('museBadge:"Асистент"'),"i18n.js: uk museBadge");
ok(i18n.includes('museNoSetup:"Не потребує налаштування"'),"i18n.js: uk museNoSetup");

// 3. _worker.js: providers.muse=true в /api/status
ok(/providers\.muse=true/.test(worker),"_worker.js: /api/status встановлює providers.muse=true");
// Muse НЕ в PROVIDER_META (не чіпає VAULT_TOKEN_IDS)
{
  const m=worker.match(/const PROVIDER_META=\{([\s\S]*?)\n\};/);
  ok(m&&!m[1].includes("muse"),"_worker.js: muse НЕ в PROVIDER_META (чистий vault)");
}

// 4. sendTask перехоплює
ok(/providers\.filter\(id=>id!=="muse"/.test(app),"app.js: sendTask виключає muse з API-викликів");
ok(/showMuseCard\(\)/.test(app),"app.js: showMuseCard викликається");
ok(/function showMuseCard\(\)/.test(app),"app.js: showMuseCard визначено");

// 5. Чесність: текст картки прямо каже про відсутність API, без імітації
ok(i18n.includes("не маю публічного API"),"i18n.js: uk текст чесно каже про відсутність API");
ok(i18n.includes("have no public API"),"i18n.js: en текст чесно каже про відсутність API");
// showMuseCard не генерує фейкову відповідь — лише renderAnswer з чесним текстом
{
  const i=app.indexOf("function showMuseCard()");
  const body=app.slice(i,i+400);
  ok(body.includes('t("museCardText")'),"showMuseCard: використовує чесний i18n-текст");
  ok(!/fetch\(/.test(body),"showMuseCard: без мережевих викликів (не імітує AI)");
}

// 6. UI: бейдж і підпис
ok(/museBadge/.test(app),"app.js: бейдж Асистент у картці провайдера");
ok(/\.museBadge\{/.test(css),"styles.css: стиль .museBadge");
ok(/provNote\(id,p\)/.test(app),"app.js: provNote для підпису Muse");
ok(/museNoSetup/.test(app),"app.js: renderConnections показує «Не потребує налаштування»");

console.log("\nPASS: "+passed+" перевірок");
