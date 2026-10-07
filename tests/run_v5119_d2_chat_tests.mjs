/* D2 (хвиля 2, «Тиша»): головний екран чату — v5.11.8.
   Перевіряє: hero-банер прибрано, лишився slim-рядок (орб + AI Bridge +
   статус провайдерів + «···»); жодних підказок-стартів; композер — одна
   смуга з усіма ID; кнопки ≥44px; текст поля вводу ≥16px; i18n українською. */
import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";
const root=path.dirname(fileURLToPath(import.meta.url));
const R=p=>fs.readFileSync(path.join(root,"..",p),"utf8");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const html=R("index.html"),css=R("styles.css"),app=R("app.js"),i18n=R("i18n.js");

/* --- 1. hero-банер прибрано --- */
ok(!html.includes('class="hero ' )&&!html.includes('class="hero"'),"hero-банер видалено з index.html");
ok(!html.includes("heroTitle")&&!html.includes("heroDesc")&&!html.includes("heroSearchFlow"),"немає heroTitle/heroDesc/heroSearchFlow");
ok(!html.includes("starterGrid"),"немає starterGrid (підказки-старти)");

// slim-рядок на місці (REBUILD: рядок живе в шапці застосунку, клас може йти з іншими)
ok(/class="[^"]*\bchatTopbar\b/.test(html),"є .chatTopbar");
ok(html.includes('class="miniOrb"'),"є .miniOrb");
ok(html.includes(">AI Bridge<"),"у рядку є текст AI Bridge");
ok(html.includes('id="miniProviderStatus"'),"статус провайдерів #miniProviderStatus на місці");
/* 2026-10-03 (Сергій, макет v2): верхня кругла кнопка «···» повернута в топбар —
   поруч пігулка мережі та кнопка мови. #moreTab лишається в DOM для тега a11y. */
ok(html.includes('id="navDrawerBtn"'),"верхня кнопка #navDrawerBtn «···» на місці");
ok(html.includes('id="moreTab"'),"вкладка «Більше» (#moreTab) відкриває меню");
ok(html.includes('class="heroVersion">v'),"бейдж версії .heroVersion збережено");

/* 2026-10-01 (Сергій): крапки провайдерів — індикатор обробки: поки body.aiRunning,
   крапки пульсують кольором орба */
{
  const css=R("styles.css");
  ok(/body\.aiRunning\s+\.chatTopbar\s+\.miniProvider\s+\.statusDot/.test(css),"крапки пульсують під час обробки (body.aiRunning)");
  ok(/@keyframes\s+providerPulse/.test(css),"є анімація providerPulse");
}

/* --- 2. жодних підказок-стартів у видимій зоні --- */
// quickActions і modeChips мають жити всередині <details id="composerOpts">, а не окремо
{
  const det=html.indexOf('id="composerOpts"');
  const qa=html.indexOf('id="quickActions"'),mc=html.indexOf('id="modeChips"');
  ok(det!==-1&&qa>det&&mc>det,"#quickActions і #modeChips — всередині «Налаштування» (details)");
  const beforeDet=html.slice(0,det);
  ok(!beforeDet.includes('id="quickActions"')&&!beforeDet.includes('id="modeChips"'),"до «Налаштувань» немає видимих чипів/карток");
}

/* --- 3. композер — одна смуга, всі ID на місці --- */
ok(html.includes('class="composerStrip"'),"є .composerStrip");
{
  const ids=["prompt","sendBtn","cameraBtn","photoBtn","voiceBtn","cameraInput","photoInput"];
  for(const id of ids)ok(html.includes(`id="${id}"`),`ID #${id} збережено`);
  const sendCount=(html.match(/id="sendBtn"/g)||[]).length;
  ok(sendCount===1,"рівно одна #sendBtn (у смузі)");
  const strip=html.slice(html.indexOf('class="composerStrip"'),html.indexOf('class="composerStrip"')+4000);
  for(const id of ids)ok(strip.includes(`id="${id}"`),`#${id} — всередині .composerStrip`);
}
// порожній стан: орб + одне речення
ok(html.includes('id="chatOrb"')&&html.includes('id="chatOrbWrap"'),"#chatOrb/#chatOrbWrap на місці");
ok(!html.includes('data-i18n="orbText"'),"абзац orbText прибрано (тільки одне речення)");
// критичні ID сторінки чату
for(const id of ["answerArea","runProgress","composerOpts","attachChips","voiceStatus"])
  ok(html.includes(`id="${id}"`),`ID #${id} збережено`);

/* --- 4. app.js: логіка не зламана --- */
ok(app.includes('$("moreTab")'),"app.js: обробник #moreTab («Більше») додано");
/* v5.11.9 (злиття хвилі 2): D4 замінив шторку moreSheet правою колонкою-меню
   navDrawer — «···» відкриває її (намір тесту: кнопка відкриває навігацію). */
ok(app.includes('openSheet("navDrawer")'),"«···» відкриває navDrawer (колонку-меню D4)");
ok(app.includes('$("sendBtn")')&&app.includes('$("prompt")'),"app.js: звернення до #sendBtn і #prompt збережено");
ok(app.includes('$("voiceBtnLabel")'),"app.js: #voiceBtnLabel збережено");

/* --- 5. CSS: токени, розміри, без hex у D2-блоці --- */
{
  const d2=css.slice(css.indexOf("D2 (хвиля 2"));
  ok(!/#[0-9a-fA-F]{3,8}\b/.test(d2),"у D2-блоці немає hex-кольорів (тільки токени)");
}
ok(css.includes(".chatTopbar")&&css.includes(".composerStrip")&&css.includes(".iconBtn"),"D2-класи визначено в styles.css");
ok(/\.iconBtn\{[^}]*width:var\(--tap\)/.test(css),"кнопка «···» — 44×44 (var(--tap))");
ok(/\.composerStrip \.composerToolBtn\{[^}]*width:var\(--tap\)/.test(css),"кнопки інструментів у смузі — 44px");
ok(/\.composerStrip #prompt\{[^}]*font-size:16px/.test(css),"поле вводу в смузі — 16px");
ok(/\.composerStrip \.composerToolBtn \.toolLabel\{[^}]*display:none/.test(css),"підписи кнопок приховано (тільки іконки)");

/* --- 6. i18n: українська, без російської --- */
ok(i18n.includes('orbTitle:"Про що думаєш?"'),"uk: orbTitle = «Про що думаєш?»");
ok(i18n.includes('orbTitle:"What are you thinking about?"'),"en: orbTitle оновлено");

/* --- 7. D2 polish: кругла кнопка ↑ і компактне порожнє поле --- */
ok(/#page-chat \.composerStrip #sendBtn::after\{[^}]*content:"↑"/.test(css),"кнопка Надіслати — кругла зі стрілкою ↑ (концепт)");
ok(/#page-chat \.composerStrip #sendBtn\{[^}]*width:var\(--tap\)/.test(css),"кнопка Надіслати — 44×44");
ok(app.includes('if(!el.value){el.style.height="";return}'),"autoGrow: порожнє поле лишається компактним (плейсхолдер не роздуває)");

console.log("\nD2 chat tests: ALL PASS");
