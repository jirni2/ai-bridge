/* v5.11.93 (builder): 1) якір наміру й сигнал впевненості агента над прогоном
   agent/god/research (рядок мети + впевненість з оцінки Judge M3);
   2) стартові запитання для ролі команди — чипи-стартери у формі нового
   завдання, редагування в нижньому листі, зберігання в localStorage. */
import fs from "node:fs";import path from "node:path";import vm from "node:vm";import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),
      crew=fs.readFileSync(path.join(root,"crew.js"),"utf8"),
      html=fs.readFileSync(path.join(root,"index.html"),"utf8"),
      css=fs.readFileSync(path.join(root,"styles.css"),"utf8"),
      i18n=fs.readFileSync(path.join(root,"i18n.js"),"utf8");

// 1. якір наміру в app.js
ok(/function renderIntentAnchor\(run\)/.test(app),"app.js: renderIntentAnchor(run) існує");
ok(/renderRouteWhy\(run\);\s*\n\s*renderIntentAnchor\(run\);/.test(app),"app.js: renderIntentAnchor викликається з renderAnswer");
ok(/id="intentAnchor"|id=\"intentAnchor\"/.test(app)||/el\.id="intentAnchor"/.test(app),"app.js: елемент #intentAnchor створюється динамічно");
ok(/mode==="agent"\|\|mode==="god"\|\|mode==="research"/.test(app),"app.js: якір лише для режимів agent/god/research");
ok(/qualityScore/.test(app.match(/function renderIntentAnchor[\s\S]*?^}/m)?.[0]||""),"app.js: впевненість береться з run.meta.qualityScore");
ok(/intentAnchorGoal/.test(app)&&/intentConfidence/.test(app),"app.js: тексти лише через t() (жодної захардкодженої кирилиці)");
const anchorBody=app.slice(app.indexOf("function renderIntentAnchor"),app.indexOf("function renderAnswer"));
ok(!/[А-Яа-яЁёЇїІіЄєҐґ]/.test(anchorBody.replace(/t\(\s*["'`][\s\S]*?["'`]\s*(,\{[^}]*\})?\)/g,"").replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/[^\n]*/g,"")),"app.js: у renderIntentAnchor немає кирилиці поза t() і коментарями");

// 2. переклади (uk/en/ru) через пісочницю
const sandbox={globalThis:{},document:{documentElement:{},querySelectorAll:()=>[],getElementById:()=>null},localStorage:{getItem:()=>"uk",setItem(){}},navigator:{language:"uk"},window:{dispatchEvent(){}},CustomEvent:function(){}};sandbox.globalThis=sandbox;
vm.runInNewContext(i18n,sandbox);const I=sandbox.AIBridgeI18n;
I.setLanguage("uk");
ok(I.t("intentAnchorGoal")==="Мета","uk: intentAnchorGoal");
ok(I.t("intentConfidence",{v:84})==="Впевненість: 84%","uk: intentConfidence з плейсхолдером {v}");
ok(I.t("crewStartersTitle")==="Стартові запитання","uk: crewStartersTitle");
ok(I.t("crewStartersSaved")==="Стартові запитання збережено","uk: crewStartersSaved");
ok(I.t("crewStarter1")==="Проаналізуй мій останній звіт","uk: crewStarter1");
I.setLanguage("en");
ok(I.t("intentAnchorGoal")==="Goal","en: intentAnchorGoal");
ok(I.t("intentConfidence",{v:84})==="Confidence: 84%","en: intentConfidence");
ok(I.t("crewStartersTitle")==="Conversation starters","en: crewStartersTitle");
ok(I.t("crewStarter3")==="Propose an action plan","en: crewStarter3");
I.setLanguage("ru");
ok(I.t("intentAnchorGoal")==="Цель","ru: intentAnchorGoal");
ok(I.t("crewStartersTitle")==="Стартовые вопросы","ru: crewStartersTitle");
ok(I.t("crewStarter2")==="Найди ошибки в этом тексте","ru: crewStarter2");

// 3. crew.js — стартові запитання
ok(/bridge_role_starters_v1/.test(crew),"crew.js: ключ localStorage bridge_role_starters_v1");
ok(/function renderRoleStarters\(\)/.test(crew),"crew.js: renderRoleStarters()");
ok(/function openStartersSheet\(role\)/.test(crew),"crew.js: openStartersSheet(role)");
ok(/data-starter/.test(crew),"crew.js: чипи-стартери з data-starter");
ok(/crewStartersEdit/.test(crew),"crew.js: кнопка редагування стартових запитань");
ok(/\$\("crewTaskRole"\)\?\.addEventListener\("change",renderRoleStarters\)/.test(crew),"crew.js: перерендер стартерів при зміні ролі");
ok(/renderRoleStarters\(\);renderAgents\(\)/.test(crew),"crew.js: перерендер стартерів при зміні мови");
ok(/renderRoleStarters\(\); \/\* v5\.11\.93/.test(crew)||/openTaskForm[\s\S]*?renderRoleStarters\(\)/.test(crew),"crew.js: openTaskForm показує стартери ролі");
ok(/slice\(0,4\)/.test(crew),"crew.js: максимум 4 стартові запитання на роль");
ok(/crewStartersSaved/.test(crew),"crew.js: тост про збереження через t()");

// 4. index.html + styles.css
ok(html.includes('id="crewStarters"'),"index.html: контейнер #crewStarters у формі нового завдання");
ok(/\.intentAnchor\{/.test(css),"styles.css: .intentAnchor");
ok(/\.intentConfBar/.test(css),"styles.css: смуга впевненості .intentConfBar");
ok(/#crewStarters\b/.test(css),"styles.css: стилі #crewStarters");
ok(/#crewStartersSheet textarea/.test(css),"styles.css: textarea в листі редагування");

console.log("v5.11.93 intent anchor + crew starters tests PASS");
