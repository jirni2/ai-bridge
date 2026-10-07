/* v5.11.56 — Органайзер вкладки «Агенти» + композер-пігулка:
   1) index.html #page-crew: структура органайзера (stats, секції, FAB, details-наналаштування),
      всі функціональні ID збережено.
   2) crew.js: renderAgents → плоска сітка .crew-ocard; renderStats(); renderTasks → .crew-otask
      з .pill; renderReleases → .crew-orel з .btn.ok/.btn.no; renderEvents → .crew-timeline .ev;
      FAB відкриває форму нового завдання.
   3) styles.css: блок v5.11.56 (органайзер) + композер-пігулка (prompt 999px, strip 28px).
   4) i18n: crewOrgEyebrow, crewOrgSub, crewStatOnline, crewStatActive, crewStatBudget (uk/en). */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const html=R("index.html"),css=R("styles.css"),crew=R("crew.js"),i18n=R("i18n.js");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

/* --- 1. HTML: структура органайзера, ID збережено --- */
for(const id of ["crewAgents","crewTasks","crewTaskFilters","crewReleases","crewEvents","crewMedia",
  "crewTaskRole","crewTaskTitle","crewTaskInput","crewTaskCreate",
  "crewCfgEnabled","crewCfgAuto","crewCfgBudget","crewCfgNote","crewCfgSave","crewStopAll",
  "crewConn","crewRetry","crewAgentSummary",
  "crewStatAgents","crewStatTasks","crewStatBudget","crewRelBadge","crewFab","crewNewTaskDetails"])
  ok(html.includes(`id="${id}"`),`index.html: id="${id}" присутній`);
ok(html.includes('data-i18n="crewOrgEyebrow"'),"index.html: crewOrgEyebrow");
ok(html.includes('data-i18n="crewOrgSub"'),"index.html: crewOrgSub");
ok(html.includes('data-i18n="crewStatOnline"'),"index.html: crewStatOnline");
ok(html.includes("<details class=\"crew-cfg\">"),"index.html: налаштування згорнуто в details.crew-cfg");
ok(html.includes('class="crew-stats"'),"index.html: блок crew-stats");
ok(html.includes('class="crew-fab"'),"index.html: FAB crew-fab");

/* --- 2. crew.js: нова структура рендеру --- */
ok(crew.includes("crew-ocard"),"crew.js: картки агентів .crew-ocard");
ok(crew.includes("function renderStats()"),"crew.js: function renderStats()");
ok(crew.includes("crew-otask"),"crew.js: картки завдань .crew-otask");
ok(crew.includes("taskPillClass"),"crew.js: taskPillClass для пігулок статусу");
ok(crew.includes("crew-orel"),"crew.js: картки релізів .crew-orel");
ok(crew.includes("crew-timeline"),"crew.js: таймлайн .crew-timeline");
ok(crew.includes('class="chip'),"crew.js: чипи-фільтри .chip");
ok(crew.includes("crewFab"),"crew.js: обробник FAB");
ok(crew.includes("crewRelBadge"),"crew.js: бейдж crewRelBadge");
/* старі класи не використовуються в новому рендері */
ok(!crew.includes("crew-agent st-"),"crew.js: старий .crew-agent більше не рендериться");
ok(!crew.includes("crew-evRow"),"crew.js: старий .crew-evRow більше не рендериться");

/* --- 3. styles.css: органайзер + пігулка --- */
ok(css.includes("v5.11.56"),"styles.css: блок v5.11.56");
ok(css.includes(".crew-ocard"),"styles.css: .crew-ocard");
ok(css.includes(".crew-otask"),"styles.css: .crew-otask");
ok(css.includes(".crew-orel"),"styles.css: .crew-orel");
ok(css.includes(".crew-timeline"),"styles.css: .crew-timeline");
ok(css.includes(".crew-fab"),"styles.css: .crew-fab");
ok(css.includes(".crew-stats"),"styles.css: .crew-stats");
ok(css.includes("details.crew-cfg"),"styles.css: details.crew-cfg");
ok(/#page-chat \.composerStrip #prompt\{[^}]*border-radius:999px/.test(css),"styles.css: prompt border-radius:999px (пігулка)");
ok(/#page-chat \.composerStrip\{[^}]*border-radius:28px/.test(css),"styles.css: composerStrip border-radius:28px");

/* --- 4. i18n --- */
for(const k of ["crewOrgEyebrow","crewOrgSub","crewStatOnline","crewStatActive","crewStatBudget"]){
  ok(i18n.includes(k+':"ОРГАНІЗАТОР"')||i18n.includes(k+':"'),`i18n.js: ключ ${k}`);
}
ok(i18n.includes('crewOrgSub:"Хто працює'),"i18n.js: crewOrgSub українською");
ok(i18n.includes('crewOrgEyebrow:"ORGANIZER"'),"i18n.js: crewOrgEyebrow англійською");

console.log(`\nPASS: ${passed} перевірок`);
