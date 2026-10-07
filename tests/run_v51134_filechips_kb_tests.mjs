/* v5.11.34 — чипи згенерованих агентом файлів під повідомленням
   (LibreChat v0.8.6 "generated file chips") + поле вводу не ховається під
   клавіатурою iOS (visualViewport).
   1) _worker.js: нова дія агента generate_file — парсинг, пакування в безпечний
      data: URL, ліміти, санітизація імені, наскрізний прогін runAgent.
   2) app.js/styles.css/i18n.js: чипи під повідомленням, санітизація клієнта,
      мітки трасування, iOS-клавіатура через visualViewport.
   3) Жорсткі заборони: trade/, binance-bot/, backtests/, scheduler-worker/,
      trade-core.mjs не чіпаємо. */
import fs from "node:fs";
import assert from "node:assert/strict";
import {execSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const worker=R("_worker.js"),app=R("app.js"),css=R("styles.css"),i18n=R("i18n.js");

let passed=0;
function ok(v,msg){assert.ok(v,msg);passed++;console.log("✓",msg)}

/* --- 0. заборонені зони не чіпаємо --- */
let changed=[];try{changed=execSync("git diff --name-only",{cwd:root,encoding:"utf8",stdio:["ignore","pipe","ignore"]}).split("\n").filter(Boolean)}catch(e){/* v5.11.92: ZIP без git — перевірку пропущено */}
const FORBID=["trade/","binance-bot/","backtests/","scheduler-worker/","trade-core.mjs"];
ok(!changed.some(f=>FORBID.some(b=>f===b||f.startsWith(b))),`заборонені зони не змінено (${changed.join(", ")||"—"})`);

/* --- 1. парсинг дії generate_file --- */
const tmp=new URL("./worker-v51134-under-test.mjs",import.meta.url);
fs.writeFileSync(tmp,worker);
const m=await import(tmp.href+"?t="+Date.now());
try{
  const good=m.parseAgentAction('{"action":"generate_file","name":"report.md","mime":"text/markdown","content":"# Звіт\\nтекст","purpose":"звіт для користувача"}');
  assert.deepEqual(good,{action:"generate_file",name:"report.md",content:"# Звіт\nтекст",mime:"text/markdown",purpose:"звіт для користувача"});
  ok(true,"parseAgentAction приймає generate_file");
  assert.equal(m.parseAgentAction('{"action":"generate_file","name":"x.exe","mime":"application/x-msdownload","content":"bin"}'),null);
  ok(true,"parseAgentAction відхиляє mime поза allowlist");
  assert.equal(m.parseAgentAction('{"action":"generate_file","name":"empty.md","mime":"text/markdown","content":"  "}'),null);
  ok(true,"parseAgentAction відхиляє порожній контент");
  assert.equal(m.AGENT_MAX_FILE_GENERATIONS,3);
  ok(true,"AGENT_MAX_FILE_GENERATIONS=3 експортовано");
  ok(worker.includes('"generate_file"')&&/AGENT_ACTIONS=new Set\(\[[^\]]*"generate_file"/.test(worker),"generate_file в AGENT_ACTIONS");
  ok(/"generate_file","name":"report\.md"/.test(worker),"контролер знає про generate_file (системний промпт)");

  /* --- 2. пакування файла --- */
  const art=m.buildAgentFileArtifact({name:"../../etc/passwd.md",mime:"text/markdown",content:"# hi"});
  assert.equal(art.type,"file");
  assert.ok(!art.name.includes("..")&&!art.name.includes("/"),"ім'я без traversal: "+art.name);
  assert.ok(art.name.endsWith(".md"),"розширення з mime: "+art.name);
  assert.ok(art.dataUrl.startsWith("data:text/markdown;base64,"),"data: URL коректний");
  ok(true,"buildAgentFileArtifact санітизує ім'я й пакує data: URL");
  const art2=m.buildAgentFileArtifact({name:"data.csv.exe",mime:"text/csv",content:"a,b"});
  assert.ok(art2.name.endsWith(".csv")&&!art2.name.endsWith(".exe"),"розширення примусово з mime: "+art2.name);
  ok(true,"buildAgentFileArtifact не дає підмінити розширення");
  assert.throws(()=>m.buildAgentFileArtifact({name:"x.md",mime:"text/markdown",content:""}),/empty/);
  assert.throws(()=>m.buildAgentFileArtifact({name:"x.md",mime:"text/markdown",content:"y".repeat(200000)}),/too large/);
  const art3=m.buildAgentFileArtifact({name:"page.html",mime:"text/html",content:"<b>x</b>"});
  assert.ok(art3.name.endsWith(".html")&&art3.mime==="text/html","html з allowlist проходить");
  ok(true,"buildAgentFileArtifact відхиляє порожнє/завелике, пропускає html з allowlist");

  /* --- 3. наскрізний прогін: generate_file -> finish --- */
  let seq=0;
  const env={AI:{run:async()=>{seq++;const text=seq===1
    ?'{"action":"generate_file","name":"tiktok-text.txt","mime":"text/plain","content":"Мотиваційний текст для відео","purpose":"текст для TikTok"}'
    :'{"action":"finish","answer":"Готово — текст у файлі нижче."}';
    return {choices:[{message:{content:text}}]}}}};
  const out=await m.runAgent(env,{task:"Зроби текст для TikTok",providerPrompt:"Зроби текст для TikTok",providerIds:[],maxSteps:3});
  assert.equal(out.final,"Готово — текст у файлі нижче.");
  const files=(out.artifacts||[]).filter(a=>a.type==="file");
  assert.equal(files.length,1,"один файл-артефакт");
  assert.ok(files[0].name.endsWith(".txt"),"ім'я: "+files[0].name);
  assert.ok(files[0].dataUrl.startsWith("data:text/plain;base64,"),"data: URL");
  const trace=out.meta?.agentTrace||[];
  assert.ok(trace.some(x=>x.action==="generate_file"&&x.name),"трасування містить generate_file з ім'ям");
  ok(true,"runAgent: generate_file -> finish, файл в artifacts, слід у трасуванні");
}finally{fs.unlinkSync(tmp)}

/* --- 4. клієнт: чипи --- */
ok(/function safeAgentFileArtifact\(/.test(app),"app.js: safeAgentFileArtifact існує");
ok(/AGENT_FILE_MIMES_CLIENT=/.test(app),"app.js: клієнтський allowlist mime");
ok(/agentFileChips/.test(app)&&/agentFileChipDl/.test(app),"app.js: рендер чипів з кнопкою завантаження");
ok(/t\("agentFileChips"\)/.test(app)&&/t\("agentFileSave"\)/.test(app),"app.js: чипи йдуть через i18n");
ok(/x\.action==="generate_file"\?/.test(app),"app.js: трасування показує ім'я файла");
ok(/\.agentFileChip\{/.test(css)&&/\.agentFileChipDl\{/.test(css),"styles.css: стилі чипів");
ok(/\.agentFileChipDl\{[^}]*min-width:44px/.test(css),"styles.css: тач-ціль кнопки завантаження ≥44px");
for(const k of ["agentTrace_generate_file","agentPhase_generating_file","agentFileSave","agentFileChips"]){
  ok(new RegExp(`${k}:"[^"]*[А-Яа-яЇїІіЄєҐґ]`).test(i18n),`i18n: uk-переклад ${k}`);
  ok(new RegExp(`${k}:"[A-Za-z]`).test(i18n),`i18n: en-рядок ${k}`);
}
const appNoCyr=app.replace(/\/\*[\s\S]*?\*\//g,"").replace(/([^:])\/\/[^\n]*/g,"$1");
ok(!/[А-Яа-яЁёЇїІіЄєҐґ]/.test(appNoCyr.split("\n").filter(l=>/agentFileChip|generate_file|IosKeyboard|visualViewport/.test(l)&&!/\bt\(/.test(l)).join("\n")),"app.js: новий UI-текст — лише через t()");

/* --- 5. iOS-клавіатура --- */
ok(/function initIosKeyboardFix\(\)/.test(app),"app.js: initIosKeyboardFix існує");
ok(/initIosKeyboardFix\(\);/.test(app),"app.js: initIosKeyboardFix викликається при старті");
ok(/window\.visualViewport/.test(app),"app.js: слухає visualViewport");
ok(/setProperty\("--kb"/.test(app),"app.js: ставить CSS-змінну --kb");
ok(/iPhone\|iPad\|iPod/.test(app),"app.js: компенсація тільки на iOS (на Android viewport стискається сам)");
ok(/\.tabs\{[^}]*bottom:var\(--kb,0px\)/.test(css),"styles.css: .tabs піднімається над клавіатурою");
ok(/\.app\{[^}]*var\(--kb,0px\)/.test(css),"styles.css: .app отримує нижній відступ під клавіатуру");
ok(/scrollIntoView\(\{block:"center"\}\)/.test(app),"app.js: фокусоване поле докручується у видиму зону");

console.log(`\nPASS: ${passed} перевірок`);
