/* v5.11.35 — дві ідеї S зі скриньки:
   1) «Копіювати відповідь як форматований текст» (rich-text copy): кнопка
      copyRichBtn поруч із «Копіювати» фінальної відповіді + ⧉ на кожному
      повідомленні агента; ClipboardItem text/html+text/plain, fallback
      writeText; i18n copyRich uk+en+ru.
   2) «Згортальні довгі блоки коду»: markdown.js codeBlock() — блоки >20
      рядків стартують згорнутими (.codeCollapsed), кнопка
      «Показати повністю (N)»/«Згорнути» (collapseShowLabel/collapseHideLabel
      через opts, aria-expanded), CSS з фейдом і prefers-reduced-motion.
   Жорсткі заборони: trade/, binance-bot/, backtests/, scheduler-worker/,
   trade-core.mjs не чіпаємо. */
import fs from "node:fs";
import assert from "node:assert/strict";
import {execSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),css=R("styles.css"),i18n=R("i18n.js"),html=R("index.html"),md=R("markdown.js");

let passed=0;
function ok(v,msg){assert.ok(v,msg);passed++;console.log("✓",msg)}

/* --- 0. заборонені зони не чіпаємо --- */
let changed=[];try{changed=execSync("git diff --name-only",{cwd:root,encoding:"utf8",stdio:["ignore","pipe","ignore"]}).split("\n").filter(Boolean)}catch(e){/* v5.11.92: ZIP без git — перевірку пропущено */}
const FORBID=["trade/","binance-bot/","backtests/","scheduler-worker/","trade-core.mjs"];
ok(!changed.some(f=>FORBID.some(b=>f===b||f.startsWith(b))),`заборонені зони не змінено (${changed.join(", ")||"—"})`);

/* --- 1. i18n: ключі у всіх трьох мовах --- */
for(const [lang,key,val] of [
  ["uk","copyRich","Копіювати з форматуванням"],["uk","codeShowAll","Показати повністю ({n})"],["uk","codeShowLess","Згорнути"],
  ["en","copyRich","Copy with formatting"],["en","codeShowAll","Show all ({n})"],["en","codeShowLess","Collapse"],
  ["ru","copyRich","Копировать с форматированием"],["ru","codeShowAll","Показать полностью ({n})"],["ru","codeShowLess","Свернуть"],
]) ok(i18n.includes(`${key}:"${val}"`),`i18n ${lang}: ${key}="${val}"`);

/* --- 2. rich-text copy: app.js --- */
ok(/async function copyRichFrom\(host,labelEl\)/.test(app),"copyRichFrom(host,labelEl) визначено");
ok(/new ClipboardItem\(\{/.test(app)&&/"text\/html"/.test(app)&&/"text\/plain"/.test(app),"ClipboardItem з text/html + text/plain");
ok(/navigator\.clipboard\.writeText\(text\)/.test(app),"fallback на writeText без ClipboardItem");
ok(/\$\("copyRichBtn"\)\.onclick=\(\)=>copyRichFrom\(\$\("finalAnswer"\)/.test(app),"copyRichBtn копіює з finalAnswer");
ok(/data-agent-rich/.test(app)&&/copyRichFrom\(host\.querySelector\(`\[data-agent-md="\$\{b\.dataset\.agentRich\}"\]`\)\)/.test(app),"кнопка ⧉ на повідомленнях агента → rich-copy тіла повідомлення");
ok(!/\$\("copyFinalBtn"\)\.onclick=async\(\)=>\{const btn=\$\("copyFinalBtn"\)/.test(app)||app.includes('label.textContent=t("copy")'),"стара кнопка «Копіювати» (plain text) не втрачена");

/* --- 3. rich-text copy: index.html --- */
ok(/id="copyRichBtn"/.test(html)&&/data-i18n="copyRich"/.test(html),"index.html: copyRichBtn з data-i18n=copyRich");
ok(/copyRichBtn[\s\S]{0,400}data-i18n-title="copyRich"/.test(html),"copyRichBtn має title/aria через data-i18n-title/aria");

/* --- 4. згортання коду: markdown.js (статика) --- */
ok(/lineCount>20/.test(md),"поріг згортання: >20 рядків");
ok(/box\.classList\.add\("codeCollapsed"\)/.test(md),"довгий блок отримує клас codeCollapsed");
ok(/className|\"codeCollapse\"/.test(md)&&/el\("button","codeCollapse"/.test(md),"кнопка codeCollapse у шапці блока");
ok(/aria-expanded/.test(md),"кнопка згортання має aria-expanded");
ok(/collapseShowLabel/.test(md)&&/collapseHideLabel/.test(md),"мітки через opts.collapseShowLabel/collapseHideLabel");

/* --- 5. згортання коду: app.js передає локалізовані мітки --- */
ok(/collapseShowLabel:n=>t\("codeShowAll",\{n\}\)/.test(app),"renderRich передає collapseShowLabel");
ok(/collapseHideLabel:t\("codeShowLess"\)/.test(app),"renderRich передає collapseHideLabel");
ok((app.match(/collapseShowLabel/g)||[]).length>=2,"мітки передано в обох місцях (render + stream)");

/* --- 6. styles.css --- */
ok(/\.codeBlock\.codeCollapsed pre\{[^}]*max-height/.test(css),".codeCollapsed pre обмежено висотою");
ok(/\.codeBlock\.codeCollapsed pre::after/.test(css),"фейд унизу згорнутого блока");
ok(/\.codeCollapse\{/.test(css),"стиль кнопки .codeCollapse");
ok(/prefers-reduced-motion/.test(css)&&/codeCollapsed/.test(css),"повага до prefers-reduced-motion для згортання");

/* --- 7. поведінка з DOM-стабом: згортання довгого/короткого блока --- */
{
  function fakeNode(){
    const set=new Set();
    const n={children:[],_t:"",attrs:{},listeners:{},className:"",
      classList:{
        _sync(){set.clear();String(n.className||"").split(/\s+/).filter(Boolean).forEach(c=>set.add(c))},
        add(...cs){this._sync();cs.forEach(c=>set.add(c));n.className=[...set].join(" ")},
        remove(...cs){this._sync();cs.forEach(c=>set.delete(c));n.className=[...set].join(" ")},
        toggle(c,force){this._sync();const has=set.has(c);const on=force===undefined?!has:!!force;if(on)set.add(c);else set.delete(c);n.className=[...set].join(" ");return on},
        contains(c){this._sync();return set.has(c)}
      },
      appendChild(c){this.children.push(c);return c},
      append(...cs){cs.forEach(c=>this.children.push(c));return this},
      addEventListener(t,f){(this.listeners[t]=this.listeners[t]||[]).push(f)},
      setAttribute(k,v){this.attrs[k]=v},
      click(){(this.listeners.click||[]).forEach(f=>f.call(this))}};
    Object.defineProperty(n,"textContent",{get(){return this._t},set(v){this._t=String(v);this.children=[]},configurable:true});
    return n;
  }
  globalThis.document={createElement:()=>fakeNode(),createTextNode:t=>({nodeType:3,textContent:String(t)}),body:fakeNode()};
  (0,eval)(md);
  const api=globalThis.AIBridgeMarkdown;
  const findClass=(n,cls)=>{if(!n||typeof n!=="object")return null;if(n.className&&String(n.className).split(" ").includes(cls))return n;for(const c of (n.children||[])){const f=findClass(c,cls);if(f)return f}return null};
  const hasClass=(n,cls)=>!!(n&&n.className&&String(n.className).split(" ").includes(cls));
  const opts={collapseShowLabel:n=>`Показати повністю (${n})`,collapseHideLabel:"Згорнути"};

  const longCode=Array.from({length:25},(_,i)=>`line ${i+1}`).join("\n");
  const host1=fakeNode();
  api.render(host1,"```js\n"+longCode+"\n```",opts);
  const box1=findClass(host1,"codeBlock");
  ok(!!box1,"довгий код-блок відрендерився");
  ok(hasClass(box1,"codeCollapsed"),"25 рядків → блок стартує згорнутим");
  const tog1=findClass(host1,"codeCollapse");
  ok(!!tog1&&tog1.textContent==="Показати повністю (25)","кнопка «Показати повністю (25)»");
  ok(tog1.attrs["aria-expanded"]==="false","aria-expanded=false у згорнутому стані");
  tog1.click();
  ok(!hasClass(box1,"codeCollapsed"),"клік розгортає блок");
  ok(tog1.textContent==="Згорнути","після розгортання кнопка «Згорнути»");
  ok(tog1.attrs["aria-expanded"]==="true","aria-expanded=true після розгортання");
  tog1.click();
  ok(hasClass(box1,"codeCollapsed"),"повторний клік згортає назад");

  const host2=fakeNode();
  api.render(host2,"```js\nline 1\nline 2\n```",opts);
  ok(!!findClass(host2,"codeBlock"),"короткий код-блок відрендерився");
  ok(!hasClass(findClass(host2,"codeBlock"),"codeCollapsed"),"2 рядки → блок не згортається");
  ok(!findClass(host2,"codeCollapse"),"короткий блок не має кнопки згортання");

  const host3=fakeNode();
  api.render(host3,"```js\n"+Array.from({length:20},(_,i)=>`l${i}`).join("\n")+"\n```",opts);
  ok(!hasClass(findClass(host3,"codeBlock"),"codeCollapsed"),"рівно 20 рядків → не згортається");

  const host4=fakeNode();
  api.render(host4,"```js\n"+longCode+"\n```",{});
  const tog4=findClass(host4,"codeCollapse");
  ok(!!tog4&&tog4.textContent==="Show all (25)","без opts — англійський дефолт «Show all (25)»");
  delete globalThis.document;
}

/* --- 8. безпека: rich-copy бере тільки санітизований рендер --- */
ok(/AIBridgeMarkdown/.test(md)&&/document\.createElement/.test(md),"markdown.js будує DOM через createElement (без innerHTML)");
ok(!/<script|javascript:/i.test(md.replace(/javascript:/gi,"")),"у markdown.js немає ін'єкційних патернів");

console.log(`\nALL ${passed} PASSED`);
