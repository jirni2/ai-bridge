/* v5.11.17 — безпечний стрімінговий рендер markdown + цитата-відповідь.
   1) markdown.js: createStreamRenderer (rAF-пакетування, пропуск незміненого тексту,
      scheduler.yield), кнопка «Завантажити» на code-блоках, codeDownloadName (чиста).
   2) app.js: buildQuoteBlock (чиста), quoteAgentMessage, data-agent-quote, renderRichStreamed,
      renderRich передає downloadLabel/downloadedLabel, quoteFinalBtn + cmdk.
   3) Санітизація: markdown.js ніколи не використовує innerHTML (DOM-only, https-only).
   4) i18n uk+en: codeDownload, codeDownloaded, quoteBtn. index.html: #quoteFinalBtn. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const mdSrc=R("markdown.js"),app=R("app.js"),i18n=R("i18n.js"),html=R("index.html"),css=R("styles.css");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabFn(src,name){
  const m=src.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`,"m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name);
  return m[0];
}

/* --- 1. санітизація: жодного innerHTML у рендері markdown --- */
{
  const codeOnly=mdSrc.split("\n").filter(l=>!l.trim().startsWith("*")&&!l.trim().startsWith("/*")&&!l.trim().startsWith("//")).join("\n");
  ok(!/\.innerHTML\s*=/.test(codeOnly),"markdown.js: жодного innerHTML= в коді (DOM-only рендер)");
  ok(/u\.protocol==="https:"/.test(mdSrc)||/protocol==="https:"/.test(mdSrc),"markdown.js: посилання лише https");
}

/* --- 2. codeDownloadName (чиста) --- */
{
  (0,eval)(grabFn(mdSrc,"codeDownloadName"));
  ok(codeDownloadName("py",3)==="snippet-3.py","py → snippet-3.py");
  ok(codeDownloadName("js",1)==="snippet-1.js","js → snippet-1.js");
  ok(codeDownloadName("C++",2)==="snippet-2.txt","невідоме розширення → .txt");
  ok(codeDownloadName("javascript",1)==="snippet-1.txt","javascript (не в білому списку) → .txt");
  ok(codeDownloadName("",0)==="snippet-1.txt","порожнє/0 → snippet-1.txt");
  ok(codeDownloadName("py",-5)==="snippet-1.py","від'ємний індекс → 1");
  ok(!/[<>:"/\\|?*]/.test(codeDownloadName("../../etc",7)),"ім'я файлу без небезпечних символів");
}

/* --- 3. кнопка «Завантажити» на code-блоках --- */
{
  ok(mdSrc.includes('"codeDownload"')||mdSrc.includes("'codeDownload'"),"markdown.js: клас codeDownload");
  ok(mdSrc.includes("createObjectURL")&&mdSrc.includes("Blob"),"markdown.js: завантаження через Blob");
  ok(/downloadLabel/.test(mdSrc)&&/downloadedLabel/.test(mdSrc),"markdown.js: i18n-мітки для кнопки");
  ok(css.includes(".codeDownload"),"styles.css: стиль .codeDownload");
  ok(/downloadLabel:t\("codeDownload"\)/.test(app),"app.js: renderRich передає downloadLabel");
}

/* --- 4. createStreamRenderer: експорт і механіка --- */
{
  ok(/createStreamRenderer/.test(mdSrc),"markdown.js: createStreamRenderer визначено");
  ok(/createStreamRenderer,safeUrl/.test(mdSrc)||/render,createStreamRenderer/.test(mdSrc),"markdown.js: createStreamRenderer в експорті AIBridgeMarkdown");
  ok(/requestAnimationFrame/.test(mdSrc),"markdown.js: пакетування через requestAnimationFrame");
  ok(/scheduler\.yield/.test(mdSrc),"markdown.js: scheduler.yield перед важким рендером");
  ok(/lastRendered/.test(mdSrc),"markdown.js: пропуск незміненого тексту");
  ok(app.includes("function renderRichStreamed"),"app.js: renderRichStreamed");
  ok(/richStreamHosts/.test(app),"app.js: кеш рендерерів на WeakMap");
}

/* --- 5. buildQuoteBlock (чиста) --- */
{
  (0,eval)(grabFn(app,"buildQuoteBlock"));
  ok(buildQuoteBlock("привіт")==="> привіт\n\n","простий текст → блок цитати");
  ok(buildQuoteBlock("a\nb")==="> a\n> b\n\n","багаторядковий текст");
  ok(buildQuoteBlock("")===""&&buildQuoteBlock("   ")==="","порожнє → порожнє");
  ok(buildQuoteBlock("a\r\nb")==="> a\n> b\n\n","CRLF нормалізується");
  const long=buildQuoteBlock("x".repeat(500),400);
  ok(long.startsWith("> x")&&long.endsWith("…\n\n"),"довгий текст обрізається з …");
  ok(long.length===2+400+1+2,"обрізка рівно до maxLen");
  ok(buildQuoteBlock("коротко",400)==="> коротко\n\n","maxLen не ріже коротке");
}

/* --- 6. quote-reply: прив'язка в UI --- */
{
  ok(app.includes("function quoteAgentMessage"),"app.js: quoteAgentMessage");
  ok(app.includes("data-agent-quote"),"app.js: кнопка ❝ у renderAgentThread");
  ok(/threadMdRendered/.test(app),"app.js: WeakMap для пропуску незміненого markdown");
  ok(app.includes('$("quoteFinalBtn").onclick'),"app.js: обробник quoteFinalBtn");
  ok(/label:t\("quoteBtn"\)/.test(app),"app.js: cmdk-команда «Цитувати»");
  ok(html.includes('id="quoteFinalBtn"'),"index.html: кнопка quoteFinalBtn");
  ok(html.includes('data-i18n="quoteBtn"'),"index.html: data-i18n quoteBtn");
}

/* --- 7. i18n uk+en --- */
{
  const m=i18n.match(/const V51117=\{[\s\S]*?\n\};/);
  ok(!!m,"i18n.js: блок V51117");
  (0,eval)(m[0]+";globalThis.__v=V51117;");
  const V=globalThis.__v;
  for(const k of ["codeDownload","codeDownloaded","quoteBtn"]){
    ok(typeof V.en[k]==="string"&&V.en[k].length>0,"en."+k+" = "+V.en[k]);
    ok(typeof V.uk[k]==="string"&&V.uk[k].length>0,"uk."+k+" = "+V.uk[k]);
  }
  ok(V.uk.quoteBtn==="Цитувати"&&V.uk.codeDownload==="Завантажити","uk-переклади коректні");
}

/* --- 8. поведінка createStreamRenderer з DOM-стабом --- */
{
  function fakeNode(){
    const n={children:[],_t:"",attrs:{},listeners:{},className:"",
      classList:{add(){},remove(){},toggle(){},contains(){return false}},
      appendChild(c){this.children.push(c);return c},
      append(...cs){cs.forEach(c=>this.children.push(c));return this},
      addEventListener(t,f){(this.listeners[t]=this.listeners[t]||[]).push(f)},
      setAttribute(k,v){this.attrs[k]=v},
      click(){}};
    Object.defineProperty(n,"textContent",{get(){return this._t},set(v){this._t=String(v);this.children=[]},configurable:true});
    return n;
  }
  const frames=[];
  globalThis.requestAnimationFrame=f=>{frames.push(f);return frames.length};
  globalThis.document={createElement:()=>fakeNode(),createTextNode:t=>({nodeType:3,textContent:String(t)}),body:fakeNode()};
  (0,eval)(mdSrc);
  const api=globalThis.AIBridgeMarkdown;
  ok(typeof api.createStreamRenderer==="function","AIBridgeMarkdown.createStreamRenderer доступний");
  let renders=0;
  const host=fakeNode();
  const orig=Object.getOwnPropertyDescriptor(host,"textContent");
  Object.defineProperty(host,"textContent",{get:orig.get,set(v){renders++;orig.set.call(this,v)},configurable:true});
  const runFrames=()=>{const f=frames.splice(0);f.forEach(fn=>fn())};
  const findClass=(n,cls)=>{if(!n||typeof n!=="object")return null;if(n.className&&String(n.className).split(" ").includes(cls))return n;for(const c of (n.children||[])){const f=findClass(c,cls);if(f)return f}return null};

  const r=api.createStreamRenderer(host,{});
  r.push("one");r.push("one two");r.push("one two three");
  ok(frames.length===1,"три push в одному кадрі → один запланований кадр");
  ok(r.queued===true,"queued === true після push");
  runFrames();
  ok(renders===1,"три push → один рендер");
  ok(host.children.length>0,"хост отримав DOM-вузли");
  r.push("one two three");runFrames();
  ok(renders===1,"той самий текст не перерендерюється");
  r.push("```py\nprint(1)\n```");runFrames();
  ok(renders===2,"новий текст рендериться");
  ok(!!findClass(host,"codeDownload"),"code-блок має кнопку Завантажити");
  ok(!!findClass(host,"codeCopy"),"code-блок має кнопку Копіювати");
  r.push("змінено");r.flush();
  ok(renders===3,"flush рендерить одразу, без кадру");
  r.dispose();r.push("після dispose");runFrames();
  ok(renders===3,"після dispose рендерів немає");
  delete globalThis.requestAnimationFrame;delete globalThis.document;
}

/* --- 9. версія (v5.11.22: без хардкоду — звіряємо з bridge-version.json) --- */
{
  const bv=JSON.parse(R("bridge-version.json")).version;
  ok(/^\d+\.\d+\.\d+$/.test(bv),"bridge-version.json має валідну semver-версію ("+bv+")");
  ok(new RegExp(`const VERSION="${bv}";`).test(R("_worker.js")),"_worker.js синхронізовано");
}

console.log(`\nv5.11.17 render+quote: ${passed} перевірок PASS`);
