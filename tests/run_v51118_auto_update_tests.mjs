/* v5.11.17 — автооновлення без чищення кешу вручну.
   Перевірка версії через публічний /api/version (без токена), тригери:
   load, visibilitychange, кожні 15 хв. Чернетки полів вводу зберігаються,
   щоб авто-перезавантаження нічого не стерло. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),sw=R("sw.js"),html=R("index.html");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

/* --- 1. перевірка версії не вимагає авторизації --- */
ok(/fetch\("\/api\/version",\{cache:"no-store"/.test(app),"версія питається з публічного /api/version (no-store, без токена)");
ok(!/checkAppVersionAuto[\s\S]{0,400}authHeaders/.test(app),"перевірка версії не тягне authHeaders");

/* --- 2. тригери перевірки --- */
ok(/window\.addEventListener\("load",[\s\S]*?checkAppVersionAuto\(\)/.test(app),"перевірка при завантаженні");
ok(/visibilitychange[\s\S]*?checkAppVersionAuto\(\)/.test(app),"перевірка при поверненні на передній план");
ok(/setInterval\(\(\)=>\{updateSwReg\(\);checkAppVersionAuto\(\);\},15\*60\*1000\)/.test(app),"перевірка кожні 15 хвилин");
ok(/updateSwReg/.test(app)&&/getRegistration\(\)/.test(app),"оновлення service worker перед перевіркою");

/* --- 3. автооновлення один раз на версію за сесію --- */
ok(/verIsNewer\(sv,UI_VERSION\)&&!sessionStorage\.getItem\("abAutoUpd"\)/.test(app),"оновлення лише на новішу версію, один раз за сесію");
ok(/saveComposerDrafts\(\);\s*\n?\s*autoUpdateTo\(sv\)/.test(app),"чернетки зберігаються перед автооновленням");

/* --- 4. чернетки --- */
for(const fn of ["saveComposerDrafts","restoreComposerDrafts"])ok(new RegExp(`function ${fn}\\(\\)`).test(app),`функція ${fn} існує`);
ok(/abComposerDraftsV1/.test(app),"ключ сховища чернеток");
ok(/restoreComposerDrafts\(\)/.test(app),"чернетки відновлюються при старті");
ok(app.includes('addEventListener("input"')&&/el\._abDraftT=setTimeout\(saveComposerDrafts,600\)/.test(app),"збереження чернетки під час набору (debounce)");
ok(/promptEl\.value="";autoGrowTextarea\(promptEl\);renderAttachChips\(\);saveComposerDrafts\(\)/.test(app),"чернетка чиститься після відправки (чат)");
ok(/input\.value="";saveComposerDrafts\(\);dismissKeyboard/.test(app),"чернетка чиститься після відправки (агент)");
ok(/\$\("clearPromptBtn"\)\.onclick=\(\)=>\{\$\("prompt"\)\.value="";saveComposerDrafts\(\)/.test(app),"чернетка чиститься кнопкою очищення");

/* --- 5. інфраструктура оновлення ціла --- */
ok(sw.includes("skipWaiting")&&sw.includes("clients.claim"),"SW: skipWaiting + clients.claim");
ok(/updateViaCache:"none"/.test(app),"реєстрація SW з updateViaCache:none");
ok(/controllerchange/.test(app)&&/location\.reload\(\)/.test(app),"перезавантаження при зміні контролера SW");
ok(html.includes('id="updateBanner"'),"банер оновлення в HTML");

console.log(`\nPASS: ${passed} перевірок`);
