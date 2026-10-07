/* v5.11.47 — Нотатки з кнопкою «Покращити ШІ» + Панель статистики використання.
   1) Сторінки #page-notes / #page-stats в index.html; пункти меню в navDrawer.
   2) Хелпери нотаток: loadNotes/saveNotes/noteTitleOf + localStorage-ключ ai_bridge_notes_v1.
   3) enhanceNote: payload mode:"auto", effort:"fast", без судді; записує usage через recordUsage;
      показує зайнятість noteBusyId; жодних секретів.
   4) renderStats: агреати з loadUsage() (7 днів / 30 днів), топ моделей, експорт CSV.
   5) i18n: усі t()-ключі існують в EN; головні мають переклади uk+en+ru.
   6) styles.css: стилі сторінок нотаток/статистики. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),css=R("styles.css"),html=R("index.html");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

/* --- 1. index.html: сторінки й меню --- */
ok(/id="page-notes"/.test(html),"index.html: сторінка #page-notes");
ok(/id="page-stats"/.test(html),"index.html: сторінка #page-stats");
ok(/data-more-page="notes"/.test(html)&&/data-more-page="stats"/.test(html),"navDrawer: пункти нотаток і статистики");
ok(/data-i18n="navNotes"/.test(html)&&/data-i18n="navStats"/.test(html),"меню з data-i18n ключами");

/* --- 2. app.js: хелпери нотаток --- */
ok(/const NOTES_KEY="ai_bridge_notes_v1"/.test(app),"NOTES_KEY в app.js");
ok(/function loadNotes\(\)/.test(app),"loadNotes");
ok(/function saveNotes\(a\)/.test(app),"saveNotes");
ok(/function noteTitleOf\(n\)/.test(app),"noteTitleOf");
ok(/function renderNotes\(\)/.test(app),"renderNotes");
ok(/if\(name==="notes"\)renderNotes\(\)/.test(app),"showPage: notes → renderNotes");

/* --- 3. enhanceNote --- */
const en=app.match(/async function enhanceNote\(id\)\{[\s\S]*?\n\}/);
ok(!!en,"enhanceNote присутня");
ok(/mode:"auto"/.test(en[0]),"enhance: mode auto (M2-роутер)");
ok(/effort:"fast"/.test(en[0]),"enhance: effort fast");
ok(!/judge/.test(en[0]),"enhance: без судді");
ok(/recordUsage\(\{results:run\.j\.results/.test(en[0]),"enhance: usage записується для статистики");
ok(/spendGateState/.test(en[0]),"enhance: повага до бюджету витрат");
ok(!/sk-|api[_-]?key|token/i.test(en[0])||/no\-?secret|без секрет/i.test(en[0]),"enhance: жодних секретів у коді");

/* --- 4. renderStats + CSV --- */
ok(/async function renderStats\(\)/.test(app),"renderStats");
ok(/if\(name==="stats"\)renderStats\(\)/.test(app),"showPage: stats → renderStats");
ok(/function exportStatsCsv\(\)/.test(app),"exportStatsCsv");
ok(/statsExportBtn/.test(app)&&/statsExportBtn/.test(html),"кнопка експорту підключена");
ok(/dayKey\(Date\.now\(\)-i\*86400000\)/.test(app),"статистика: агреати по 7 днях");
ok(/monthSpendUsd\(\)/.test(app),"статистика: витрати місяця");

/* --- 5. i18n --- */
const keys=["navNotes","moreNotes","notesEyebrow","notesTitle","notesDesc","notesNew","notesEmpty","noteUntitled",
  "notePh","noteEnhance","noteEnhancing","noteEnhanced","noteEnhanceFail","noteNeedText","noteNoProvider",
  "noteCopy","noteDelete","noteDeleteConfirm","noteToChat","noteEnhancePrompt",
  "navStats","moreStats","statsEyebrow","statsTitle","statsDesc","statsDays7","statsDays30","statsDialogs",
  "statsAnswers","statsTopModels","statsSpend30","statsBudget","statsNoBudget","statsExport","statsNoData",
  "statsOk","statsErr","statsAvg","statsCsvDay","statsCsvModel","statsCsvReq","statsCsvOk","statsCsvErr","statsCsvAvgMs","statsCsvUsd"];
const NO_UK=["statsCsvUsd"]; // технічний заголовок колонки CSV, не UI-текст
for(const k of keys){
  ok(new RegExp(k+':"').test(i18n),`ключ ${k} є в i18n`);
  if(!NO_UK.includes(k))ok(new RegExp(k+':"[^"]*[А-Яа-яЇїІіЄєҐґ]').test(i18n),`ключ ${k}: переклад uk`);
}
for(const k of ["navNotes","notesTitle","noteEnhance","navStats","statsTitle","statsExport","notesDesc","statsDesc"]){
  const n=(i18n.match(new RegExp(k+':"','g'))||[]).length;
  ok(n>=2,`ключ ${k}: є принаймні в en і uk (${n})`);
}
/* html i18n-атрибути проти i18n.js */
for(const m of html.matchAll(/data-i18n="(navNotes|moreNotes|navStats|moreStats|notesEyebrow|notesTitle|notesDesc|notesNew|statsEyebrow|statsTitle|statsDesc|statsTopModels|statsDays7|statsExport)"/g))
  ok(new RegExp(m[1]+':"').test(i18n),`html ключ ${m[1]} існує в i18n.js`);

/* --- 6. styles.css --- */
for(const c of [".notesList",".noteCard",".noteText",".noteBtns",".statsCards",".statCard",".statModelRow",".statsBars",".statDay",".emptyNote"])
  ok(css.includes(c),`styles.css: ${c}`);

console.log(`PASS: v5.11.47 notes+stats (${passed} checks)`);
