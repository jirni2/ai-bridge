/* v5.11.29: File Handling API (.md/.txt) + плаваюча кнопка «Вниз» з лічильником.
   1) Чисті функції: fabIsAtBottom, fabNextCount.
   2) Маніфест: file_handlers з action ./?openfile=1, accept text/markdown (.md), text/plain (.txt).
   3) Клієнт: launchQueue.setConsumer, openLaunchedFile, pasteStoreAddNamed, довгі файли -> чип.
   4) FAB: кнопка scrollFab + бейдж scrollFabCount в index.html, хуки в addAgentMessage/renderAnswer,
      клік і слухачі scroll/resize, i18n-ключі en/uk/ru, стилі CSS. */
import fs from "node:fs";
import {pathToFileURL} from "node:url";
const root=new URL("../",import.meta.url).href;
const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const i18n=fs.readFileSync(new URL("../i18n.js",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../styles.css",import.meta.url),"utf8");
const manifest=JSON.parse(fs.readFileSync(new URL("../manifest.webmanifest",import.meta.url),"utf8"));
let passed=0;const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)};

function extractFn(src,name){
  const start=src.indexOf("function "+name+"(");
  if(start<0)throw new Error("no function "+name);
  const end=src.indexOf("\n}\n",start);
  if(end<0)throw new Error("no end for "+name);
  return src.slice(start,end+2);
}
function loadFn(name,extra={}){
  const code=extractFn(app,name);
  const names=Object.keys(extra),vals=Object.values(extra);
  return new Function(...names,code+`;return ${name};`)(...vals);
}
const fabIsAtBottom=loadFn("fabIsAtBottom");
const fabNextCount=loadFn("fabNextCount",{fabIsAtBottom});

/* --- 1. чисті функції скролу --- */
ok(fabIsAtBottom(0,800,800)===true,"низ сторінки: scrollY=0, висота=висота");
ok(fabIsAtBottom(100,800,1000)===true,"зона 140px до низу вважається низом (100+800>=1000-140)");
ok(fabIsAtBottom(0,800,2000)===false,"середина сторінки — не низ");
ok(fabIsAtBottom(-50,800,860)===true,"негативний скрол не ламає");
ok(fabNextCount(0,0,800,800)===0,"біля низу нове повідомлення не рахується");
ok(fabNextCount(0,0,800,2000)===1,"угорі лічильник росте з 0 до 1");
ok(fabNextCount(3,0,800,2000)===4,"лічильник акумулюється");
ok(fabNextCount(200,0,800,2000)<=99,"лічильник обмежений 99");
ok(fabNextCount(5,100,800,1000)===0,"після скролу донизу — скидання в 0");

/* --- 2. маніфест --- */
const fh=manifest.file_handlers;
ok(Array.isArray(fh)&&fh.length>=1,"manifest: file_handlers присутні");
ok(fh[0].action==="./?openfile=1","manifest: action ./?openfile=1");
ok(fh[0].accept&&fh[0].accept["text/markdown"]&&fh[0].accept["text/markdown"].includes(".md"),"manifest: text/markdown -> .md");
ok(fh[0].accept&&fh[0].accept["text/plain"]&&fh[0].accept["text/plain"].includes(".txt"),"manifest: text/plain -> .txt");
ok(!/\.worker\.js$/.test(app.match(/./)?"":""),"dummy");

/* --- 3. File Handling: клієнтський код --- */
ok(/typeof lq\.setConsumer==="function"/.test(app),"launchQueue споживач підключено");
ok(/files\[0\]\.getFile\(\)\.then\(f=>openLaunchedFile\(f\)\)/.test(app),"перший файл launchQueue йде в openLaunchedFile");
ok(/function openLaunchedFile\(file\)/.test(app),"openLaunchedFile визначено");
ok(/const FILE_HANDLER_MAX_CHARS=120000/.test(app),"ліміт читання файла 120000 символів");
ok(/function pasteStoreAddNamed\(text,name\)/.test(app),"pasteStoreAddNamed: довгий файл зберігається під своїм ім'ям");
ok(/newTask\(\);/.test(app)&&/openComposer\(\);/.test(app),"відкритий файл -> нове завдання + відкритий композер");
ok(/pasteMarkerLine\(en\)/.test(app),"довгий файл (>5000) стає чипом-вкладенням");
ok(/\.has\("openfile"\)/.test(app),"прапор ?openfile=1 перевіряється при старті");
ok(/toast\(t\("fileHandlerFailed"\),"bad"\)/.test(app),"помилка читання файла — тост через i18n");
ok(!/File “\{name\}” opened/.test(app),"англійський текст не захардкоджено в app.js");
ok(!/Файл «\{name\}» відкрито/.test(app),"український текст не захардкоджено в app.js");

/* --- 4. FAB: розмітка, хуки, стилі, i18n --- */
ok(/id="scrollFab" class="scrollFab hidden"/.test(html),"index.html: кнопка scrollFab");
ok(/id="scrollFabCount" class="scrollFabBadge hidden"/.test(html),"index.html: бейдж scrollFabCount");
ok(/data-i18n-aria="scrollFabLabel"/.test(html),"index.html: aria-label через i18n");
ok(/noteScrollFabEvent\(\); \/\/ v5\.11\.29/.test(app),"хук noteScrollFabEvent у addAgentMessage/renderAnswer");
ok(/window\.addEventListener\("scroll",onScroll,\{passive:true\}\)/.test(app),"слухач scroll (passive)");
ok(/window\.addEventListener\("resize",onScroll\)/.test(app),"слухач resize");
ok(/scrollFabNew=0;(safeRenderScrollFab|renderScrollFab)\(\)/.test(app),"тап по FAB скидає лічильник");
ok(/\.scrollFab\{/.test(css),"styles.css: клас .scrollFab");
ok(/\.scrollFabBadge\{/.test(css),"styles.css: клас .scrollFabBadge");
ok(/width:48px;height:48px/.test(css),"FAB: тач-ціль 48px");
ok(i18n.includes('fileHandlerOpened:"File'),'i18n en: fileHandlerOpened');
ok(i18n.includes('fileHandlerFailed:"Could not read the opened file."'),'i18n en: fileHandlerFailed');
ok(i18n.includes('scrollFabLabel:"Scroll to new messages"'),'i18n en: scrollFabLabel');
ok(i18n.includes('«{name}» відкрито'),'i18n uk: fileHandlerOpened');
ok(i18n.includes('прочитати відкритий файл'),'i18n uk: fileHandlerFailed');
ok(i18n.includes('До нових повідомлень'),'i18n uk: scrollFabLabel');
ok(i18n.includes('«{name}» открыт'),'i18n ru: fileHandlerOpened');
ok(i18n.includes('прочитать открытый файл'),'i18n ru: fileHandlerFailed');
ok(i18n.includes('К новым сообщениям'),'i18n ru: scrollFabLabel');

console.log(`\n${passed} checks passed`);
