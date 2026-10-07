/* v5.11.50 — доступність (шрифт для дислексії, розмір тексту) + фонова модель.
   Статичні перевірки зв'язків: HTML-структура, CSS-токени, JS-ініціалізація,
   проброс backgroundModel у payload і використання _worker.js для Judge. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = p => fs.readFileSync(path.join(root, p), "utf8");
const html = R("index.html"), app = R("app.js"), css = R("styles.css"),
      worker = R("_worker.js"), i18n = R("i18n.js"), boot = R("theme-boot.js");

let passed = 0;
function ok(v, msg){ if(!v) throw new Error("FAIL: " + msg); passed++; console.log("✓", msg); }

/* --- 1. сторінка доступності в index.html --- */
ok(html.includes('id="page-access"'), "index.html: сторінка page-access існує");
ok(html.includes('data-more-page="access"'), "index.html: пункт меню access у drawer");
ok(html.includes('id="a11yDyslexic"'), "index.html: чекбокс a11yDyslexic");
ok(html.includes('id="a11ySizeSeg"'), "index.html: сегмент a11ySizeSeg");
for(const k of ["navAccess","moreAccess","accessDesc","a11yDyslexicTitle","a11yDyslexicDesc",
  "a11yTextSizeTitle","a11yTextSizeDesc","a11ySizeM","a11ySizeL","a11ySizeXL"])
  ok(html.includes(`data-i18n="${k}"`), `index.html: data-i18n="${k}" присутній`);

/* --- 2. картка фонової моделі --- */
ok(html.includes('id="bgModel"'), "index.html: select bgModel");
for(const k of ["bgModelEyebrow","bgModelTitle","bgModelDesc","bgModelAuto"])
  ok(html.includes(k), `index.html: ключ ${k} присутній`);
ok(/<option value="auto"[^>]*data-i18n="bgModelAuto"/.test(html), "index.html: опція auto з i18n");

/* --- 3. CSS-токени доступності --- */
ok(css.includes("html.a11yDyslexic"), "styles.css: клас a11yDyslexic");
ok(css.includes('html[data-a11y-size="l"]'), "styles.css: розмір l");
ok(css.includes('html[data-a11y-size="xl"]'), "styles.css: розмір xl");

/* --- 4. app.js: ініціалізація --- */
ok(/function (getA11y|applyA11y|setA11y|initA11y)\(/.test(app), "app.js: функції a11y визначено");
ok(/initA11y\(\)/.test(app), "app.js: initA11y викликано");
ok(/function getBgModel\(\)/.test(app), "app.js: getBgModel визначено");
ok(/initBgModel\(\)/.test(app), "app.js: initBgModel викликано");
ok(app.includes("backgroundModel:getBgModel()"), "app.js: backgroundModel у payload");
ok(/ai_bridge_a11y_v1/.test(app), "app.js: ключ localStorage a11y");
ok(/ai_bridge_bg_model/.test(app), "app.js: ключ localStorage bgModel");

/* --- 5. theme-boot.js: застосування до першого рендера --- */
ok(boot.includes("ai_bridge_a11y_v1"), "theme-boot.js: a11y до першого рендера");
ok(boot.includes("data-a11y-size"), "theme-boot.js: data-a11y-size");

/* --- 6. _worker.js: фоновий Judge --- */
ok(worker.includes("backgroundModel"), "_worker.js: читає body.backgroundModel");
ok(worker.includes("bgJudge"), "_worker.js: bgJudge обчислено");
ok(/judgeProvider:\s*singleChoice\|\|bgJudge/.test(worker), "_worker.js: singleChoice||bgJudge у direct-гейті");
ok(/judgeProvider:\s*bgJudge/.test(worker), "_worker.js: bgJudge у search→AI гейті");
ok(/configured\(env,\s*_bgReq\)/.test(worker), "_worker.js: валідація configured(env) перед використанням");
/* безпека: у bgJudge-шляху немає секретів */
ok(!/api[_-]?key|secret|token/i.test(worker.match(/bgJudge[\s\S]{0,200}/)?.[0]||""), "_worker.js: у bgJudge-шляху немає секретів");

/* --- 7. i18n: ключі en+uk+ru у блоці V51150 --- */
for(const k of ["navAccess","a11yDyslexicTitle","a11yTextSizeTitle","bgModelTitle","bgModelAuto"]){
  ok(i18n.includes(`${k}:`), `i18n.js: ключ ${k}`);
}
const v51150 = i18n.match(/const V51150=\{[\s\S]*?\n\};/);
ok(!!v51150, "i18n.js: блок V51150 існує");
for(const lang of ["en","uk","ru"]){
  ok(new RegExp(`^\\s*${lang}:\\{`, "m").test(v51150?.[0]||""), `i18n.js: V51150 має переклад ${lang}`);
}

console.log(`\nv5.11.50: ${passed} перевірок — OK`);
