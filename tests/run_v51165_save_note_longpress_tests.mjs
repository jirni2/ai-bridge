/* v5.11.65 — «Зберегти в нотатки» (+ «Створити список» з переліку) і
   long-press на відповіді → меню дій:
   1) extractListItems: марковані (-, •, *) та нумеровані (1., 2)) пункти.
   2) buildNoteListText: пункти → чек-лист «- [ ]».
   3) Каркас: функції в app.js, проводка кнопок, DOM-вузли в index.html,
      клас у styles.css, i18n uk+en (V51165). */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),html=R("index.html"),css=R("styles.css");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabFn(src,name){
  const m=src.match(new RegExp("^function "+name+"\\([\\s\\S]*?\\n\\}","m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name);
  return m[0];
}
globalThis.currentRun=null;
(0,eval)(`${grabFn(app,"extractListItems")}\n${grabFn(app,"buildNoteListText")}\n${grabFn(app,"answerTextForNote")}`);

/* --- 1. extractListItems --- */
ok(JSON.stringify(extractListItems(""))==="[]","порожній текст → []");
ok(JSON.stringify(extractListItems(null))==="[]","null → []");
ok(extractListItems("звичайний абзац без списку").length===0,"проза без маркерів → 0 пунктів");
{
  const r=extractListItems("Вступ\n- перший\n- другий\nКінець");
  ok(JSON.stringify(r)===JSON.stringify(["перший","другий"]),"- список: 2 пункти");
}
ok(JSON.stringify(extractListItems("• альфа\n• бета"))===JSON.stringify(["альфа","бета"]),"• список: 2 пункти");
ok(JSON.stringify(extractListItems("* один\n* два"))===JSON.stringify(["один","два"]),"* список: 2 пункти");
ok(JSON.stringify(extractListItems("1. раз\n2. два"))===JSON.stringify(["раз","два"]),"1. нумерація: 2 пункти");
ok(JSON.stringify(extractListItems("1) раз\n2) два"))===JSON.stringify(["раз","два"]),"1) нумерація: 2 пункти");
ok(JSON.stringify(extractListItems("- - вкладений"))===JSON.stringify(["вкладений"]),"- - вкладений → один чистий пункт");
ok(JSON.stringify(extractListItems("2026 рік був гарним"))===JSON.stringify([]),"\"2026 рік\" на початку рядка — не пункт");
ok(extractListItems("- лише один").length===1,"один пункт → 1 (вибір листа не відкривається, поріг ≥2)");
{
  const r=extractListItems("  - з відступом\n    2. теж з відступом");
  ok(r.length===2&&r[0]==="з відступом"&&r[1]==="теж з відступом","відступи перед маркерами ок");

  /* --- 2. buildNoteListText --- */
  ok(buildNoteListText(["купити хліб","подзвонити"])===("- [ ] купити хліб\n- [ ] подзвонити"),"пункти → чек-лист «- [ ]\"");
  ok(buildNoteListText([])==="","порожній масив → порожній рядок");

  /* --- 3. answerTextForNote без I18N --- */
  globalThis.currentRun=null;
  ok(answerTextForNote()==="","немає currentRun → порожній рядок");
  globalThis.currentRun={final:"  Відповідь  "};
  ok(answerTextForNote()==="Відповідь","final обрізається по краях");
  globalThis.currentRun={results:[{ok:false,text:"поганий"},{ok:true,text:"добрий"}]};
  ok(answerTextForNote()==="добрий","fallback — перший ok результат");
  globalThis.currentRun=null;
}

/* --- 4. каркас --- */
for(const fn of ["answerTextForNote","extractListItems","buildNoteListText","saveNoteText","saveAnswerAsNote","initLongPressMenu"])
  ok(new RegExp(`^function ${fn}\\(`, "m").test(app),`app.js: function ${fn} існує`);
ok(app.includes('openSheet("noteSaveSheet")'),"виявлено ≥2 пункти → відкривається noteSaveSheet");
ok(app.includes('$("saveNoteBtn")?.addEventListener("click",saveAnswerAsNote)'),"проводка saveNoteBtn");
ok(app.includes('$("noteSaveFullBtn")?.addEventListener("click"'),"проводка noteSaveFullBtn");
ok(app.includes('$("noteSaveListBtn")?.addEventListener("click"'),"проводка noteSaveListBtn");
ok(app.includes("initLongPressMenu();"),"initLongPressMenu викликається");
ok(/details\.open=true/.test(app),"long-press відкриває details.moreActions");
ok(app.includes("},500);"),"поріг long-press 500 мс");
ok(html.includes('id="saveNoteBtn"'),"index.html: #saveNoteBtn");
ok(html.includes('id="noteSaveSheet"'),"index.html: #noteSaveSheet");
ok(html.includes('id="noteSaveFullBtn"'),"index.html: #noteSaveFullBtn");
ok(html.includes('id="noteSaveListBtn"'),"index.html: #noteSaveListBtn");
ok(html.includes('id="noteSaveCount"'),"index.html: #noteSaveCount");
ok(html.includes('data-i18n="saveNoteBtn"'),"index.html: data-i18n для кнопки");
ok(css.includes(".longPressed"),"styles.css: .longPressed");
ok(!/[#][0-9a-fA-F]{6}/.test(css.match(/\.finalAnswer\.longPressed\{[^}]*\}/)?.[0]||""),"CSS правила longPressed — лише токени, без raw hex");

/* --- 5. i18n uk+en --- */
const pack=i18n.match(/const V51165=\{[\s\S]*?\n\};/);
ok(!!pack,"i18n.js: пак V51165 існує");
for(const k of ["saveNoteBtn","saveNoteSaved","saveNoteChoose","saveNoteFull","saveNoteList","saveNoteCount"]){
  const enPart=pack[0].split("uk:{")[0],ukPart=pack[0].split("uk:{")[1]||"";
  ok(enPart.includes(k+":"),`en: ${k}`);
  ok(ukPart.includes(k+":"),`uk: ${k}`);
}
ok(pack[0].includes("{n}"),"saveNoteCount має плейсхолдер {n}");

console.log(`\nPASS: ${passed} перевірок v5.11.65`);
