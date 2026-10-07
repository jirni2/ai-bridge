/* D3 (хвиля 2): картка відповіді і порівняння моделей — стиль «Тиша».
   Перевіряє: вкладки peer-відповідей (назва/час/бал), формат бала «4,2»,
   слот peerScore в i18n (uk/en, без російської), типографіку .md з
   внутрішнім скролом таблиць, збереження fork/TTS і XSS-ескейпінг. */
import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const css=read("styles.css"),app=read("app.js"),i18n=read("i18n.js"),md=read("markdown.js");

// --- вкладки: структура ---
ok(app.includes('role="tablist"')&&app.includes('role="tab"')&&app.includes('role="tabpanel"'),"peer answers render as tabs (tablist/tab/tabpanel)");
ok(app.includes('data-peer-tab')&&app.includes('data-peer-panel'),"tabs and panels are wired via data attributes");
ok(app.includes('aria-selected'),"tabs expose aria-selected");
ok(!app.includes('class="peerCard"'),"old swipeable peerCard markup is gone");
ok(css.includes(".peerTabs")&&css.includes(".peerTab")&&css.includes(".peerPanel"),"tab styles exist");
ok(/\.peerPanel\[hidden\]\s*\{\s*display\s*:\s*none/.test(css),"inactive panels are hidden");

// --- бал Judge: формат «4,2», слот дрібним шрифтом ---
const fmt=v=>{const n=Number(v);return Number.isFinite(n)?n.toFixed(1).replace(".",","):null};
ok(fmt(4.2)==="4,2"&&fmt(5)==="5,0"&&fmt("x")===null&&fmt(undefined)===null,"score formats as «4,2» with comma decimal");
ok(app.includes('t("peerScore"'),"tab meta renders the peerScore i18n slot");
ok(css.includes(".peerScore"),"peerScore has its own (small) style");
const v5119=i18n.match(/const V5119=\{[\s\S]*?\n\};/);
ok(v5119,"V5119 i18n pack exists");
ok(/en:\{peerScore:"Score: \{v\}"\}/.test(v5119[0]),"EN peerScore = «Score: {v}»");
ok(/uk:\{peerScore:"Оцінка: \{v\}"\}/.test(v5119[0]),"UK peerScore = «Оцінка: {v}»");
ok(!/ru:\{[^}]*peerScore/.test(v5119[0]),"no Russian peerScore added");

// --- «Тиша»: монохром, токени, без важких тіней ---
const d3block=css.slice(css.indexOf("/* ---------- D3 (хвиля 2)"));
const d3rules=d3block.slice(0,d3block.indexOf("/* ----------",10));
ok(!/#[0-9a-fA-F]{3,8}\b/.test(d3rules.replace(/\/\*[\s\S]*?\*\//g,"")),"D3 CSS adds no hex colors (tokens only)");
ok(/\.peerTab\.on\{[^}]*background:var\(--text\)/.test(css.replace(/\s+/g,"")),"active tab is monochrome (ink/paper)");
ok(css.includes(".finalAnswer{background:var(--surface)!important"),"final answer card is flat (thin border, no heavy shadow)");

// --- типографіка .md: таблиці скроляться лише всередині ---
ok(/\.md \.tableWrap\{[^}]*overflow-x:auto/.test(css.replace(/\n/g,"")),"tables scroll only inside .tableWrap");
ok(md.includes('"tableWrap"')||md.includes("'tableWrap'"),"markdown.js wraps tables in .tableWrap");

// --- 390px: вкладки переносяться, таблиця не розпирає сторінку ---
const flat=css.replace(/\n/g,"");
ok(/\.peerTabs\{[^}]*flex-wrap/.test(flat),"tab strip wraps instead of overflowing on 390px");
ok(!/\.md table\{[^}]*min-width/.test(flat),"table has no min-width that could force page-level scroll");

// --- поведінка збережена: fork/TTS, markdown, XSS ---
ok(app.includes('data-peer-fork')&&app.includes('data-peer-tts'),"per-answer fork + read-aloud kept");
ok(app.includes('data-peer-md'),"peer markdown rendering kept");
ok(app.includes('esc(t("peerScore"')&&app.includes("esc(PROVIDERS[r.provider]"),"tab labels are XSS-escaped");
ok(app.includes('closest("details")'),"peer answers stay inside the collapsible details");

console.log("\nD3 answer-card checks passed.");
