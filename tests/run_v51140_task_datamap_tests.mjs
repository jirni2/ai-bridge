/* v5.11.40 — дві ідеї scout:
   1) «Запустити як завдання» з відповіді: кнопка #taskFromAnswerBtn у меню дій,
      лист #taskSheet (назва/роль/разово|щодня), POST /api/team/tasks (kind agent)
      або POST /api/schedules; після створення — перехід у «Команду агентів».
   2) «Де живуть твої дані»: сторінка #page-datamap, пункт у колонці-меню
      data-more-page="datamap", рендер renderDataMap() з 8 чесних рядків.
   i18n — ключі uk+en; CSS мінімальний, на токенах. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = fs.readFileSync(path.join(root, "app.js"), "utf8");
const i18nSrc = fs.readFileSync(path.join(root, "i18n.js"), "utf8");
const htmlSrc = fs.readFileSync(path.join(root, "index.html"), "utf8");
const cssSrc = fs.readFileSync(path.join(root, "styles.css"), "utf8");

let passed = 0;
function ok(v, msg) {
  if (!v) throw new Error("FAIL: " + msg);
  passed++;
  console.log("✓", msg);
}

/* 1. i18n: усі ключі присутні в en і uk (fallback t() покриє решту мов). */
const keys = [
  "runAsTask","runAsTaskTitle","runAsTaskName","runAsTaskRole","runAsTaskOnce",
  "runAsTaskDaily","runAsTaskCreate","runAsTaskCreated","runAsTaskScheduled",
  "runAsTaskDup","runAsTaskFail","runAsTaskNeedTime","runAsTaskNoAnswer",
  "runAsTaskInput",
  "taskRole_coordinator","taskRole_research","taskRole_search","taskRole_analytics","taskRole_docs",
  "navDataMap","moreDataMap","dataMapDesc",
  "dmRow1t","dmRow1d","dmRow2t","dmRow2d","dmRow3t","dmRow3d","dmRow4t","dmRow4d",
  "dmRow5t","dmRow5d","dmRow6t","dmRow6d","dmRow7t","dmRow7d","dmRow8t","dmRow8d",
  "dmFoot"
];
for (const k of keys) {
  ok(new RegExp("\\b" + k + ":").test(i18nSrc), "i18n has key " + k);
}
ok(/V51140/.test(i18nSrc), "i18n version block V51140 present");

/* 2. index.html: кнопка, лист, сторінка, пункт меню. */
ok(/id="taskFromAnswerBtn"/.test(htmlSrc), "html: #taskFromAnswerBtn button");
ok(/data-i18n="runAsTask"/.test(htmlSrc), "html: button uses data-i18n runAsTask");
ok(/id="taskSheet"/.test(htmlSrc), "html: #taskSheet sheet");
ok(/id="taskName"/.test(htmlSrc) && /id="taskRole"/.test(htmlSrc) &&
   /id="taskTime"/.test(htmlSrc) && /id="taskCreateBtn"/.test(htmlSrc),
   "html: sheet has name/role/time/create controls");
ok(/name="taskFreq" value="once"/.test(htmlSrc) && /name="taskFreq" value="daily"/.test(htmlSrc),
   "html: frequency radios once/daily");
ok(/id="page-datamap"/.test(htmlSrc), "html: #page-datamap section");
ok(/id="dataMapList"/.test(htmlSrc), "html: #dataMapList host");
ok(/data-more-page="datamap"/.test(htmlSrc), "html: drawer item data-more-page=datamap");

/* 3. app.js: логіка. */
ok(/function openTaskSheet\(\)/.test(appSrc), "app: openTaskSheet defined");
ok(/function createTaskFromSheet\(\)/.test(appSrc), "app: createTaskFromSheet defined");
ok(/function fillTaskRoles\(\)/.test(appSrc), "app: fillTaskRoles defined");
ok(/fetch\("\/api\/team\/tasks",\{method:"POST"/.test(appSrc), "app: creates team task via POST /api/team/tasks");
ok(/fetch\("\/api\/schedules",\{method:"POST"/.test(appSrc), "app: creates daily schedule via POST /api/schedules");
ok(/kind:"agent"/.test(appSrc), "app: task created with kind agent");
ok(/showPage\("crew"\)/.test(appSrc), "app: navigates to crew panel after task creation");
ok(/status===409/.test(appSrc) && /runAsTaskDup/.test(appSrc), "app: handles duplicate active task (409)");
ok(/function renderDataMap\(\)/.test(appSrc), "app: renderDataMap defined");
ok(DATA_MAP_ROWS_COUNT(), "app: DATA_MAP_ROWS has 8 rows");
ok(/if\(name==="datamap"\)renderDataMap\(\)/.test(appSrc), "app: showPage renders datamap");
ok(/icon:"🚀",label:t\("runAsTask"\)/.test(appSrc), "app: cmdk entry for runAsTask");

function DATA_MAP_ROWS_COUNT() {
  const m = appSrc.match(/const DATA_MAP_ROWS=\[([\s\S]*?)\];/);
  if (!m) return false;
  return (m[1].match(/icon:/g) || []).length === 8;
}

/* 4. styles.css: мінімальні стилі на токенах. */
ok(/\.taskFreq/.test(cssSrc), "css: .taskFreq");
ok(/\.dataMapList/.test(cssSrc), "css: .dataMapList");
ok(/\.dmRow/.test(cssSrc), "css: .dmRow");
ok(!/#[0-9a-fA-F]{3,6}\b/.test(cssSrc.split("v5.11.40")[1] || ""), "css: no hardcoded colors in new block");

console.log(`\nAll ${passed} checks passed.`);
