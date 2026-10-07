/* AI Bridge v5.9 — safe Markdown renderer.
   Model output is untrusted. This renderer builds DOM nodes with
   createElement/textContent only (never innerHTML), accepts only https:
   links, and caps input size so a huge answer cannot freeze the page.
   Supported: headings, paragraphs, line breaks, bold, italic, strike,
   inline code, fenced code blocks (with copy + download buttons), ordered/unordered
   and nested lists, task lists, blockquotes, tables, horizontal rules and
   links. Anything else is shown as plain text. */
(function(g){
"use strict";
const MAX_CHARS=240000,MAX_DEPTH=4;
let codeDlSeq=0; // v5.11.19: лічильник для імен файлів кнопки «Завантажити».
const FENCE=/^\s{0,3}(`{3,}|~{3,})\s*([\w+#.\-]*)\s*$/;
const HEADING=/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const HR=/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE=/^\s{0,3}>\s?(.*)$/;
const LIST=/^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP=/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/* v5.9.1: models often write URLs with typographic hyphens (U+2010–2015,
   U+2011 non-breaking, U+2212 minus…) or invisible characters. The URL
   parser then punycodes the host into a different domain (xn--…), so the link
   silently points somewhere else. Normalize them to ASCII before parsing. */
const HYPHENS=/[\u2010-\u2015\u2212\u2043\uFE58\uFE63\uFF0D]/g,INVISIBLE=/[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
function normalizeUrlText(value){return String(value||"").replace(INVISIBLE,"").replace(HYPHENS,"-").trim()}
function safeUrl(value){
  try{const u=new URL(normalizeUrlText(value));return u.protocol==="https:"?u.toString():""}catch(e){return ""}
}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}

/* ---------- inline ---------- */
const INLINE=/(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\[([^\]\n]{1,300})\]\((https:\/\/[^\s)]{1,2000})\)|<(https:\/\/[^\s>]{1,2000})>|(https:\/\/[^\s<>"'`)\]]{2,2000})|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/g;
function appendInline(host,text,depth=0){
  const src=String(text||"");
  if(depth>MAX_DEPTH){host.appendChild(document.createTextNode(src));return}
  let last=0,m;INLINE.lastIndex=0;
  const rx=new RegExp(INLINE.source,"g");
  while((m=rx.exec(src))){
    if(m.index>last)appendText(host,src.slice(last,m.index));
    if(m[1]){host.appendChild(el("code",null,m[2].replace(/^ (.*) $/,"$1")))}
    else if(m[3]!=null||m[4]!=null){const s=el("strong");appendInline(s,m[3]??m[4],depth+1);host.appendChild(s)}
    else if(m[5]!=null){const s=el("del");appendInline(s,m[5],depth+1);host.appendChild(s)}
    else if(m[6]!=null){link(host,m[6],m[7],depth)}
    else if(m[8]!=null){link(host,m[8],m[8],depth)}
    else if(m[9]!=null){let url=m[9],tail="";const trim=url.match(/[.,;:!?]+$/);if(trim){tail=trim[0];url=url.slice(0,-tail.length)}link(host,url,url,depth);if(tail)appendText(host,tail)}
    else if(m[10]!=null||m[11]!=null){const s=el("em");appendInline(s,m[10]??m[11],depth+1);host.appendChild(s)}
    last=m.index+m[0].length;
  }
  if(last<src.length)appendText(host,src.slice(last));
}
function appendText(host,text){
  // Single newlines inside a paragraph are meaningful in plain AI answers.
  const parts=String(text).split("\n");
  parts.forEach((p,i)=>{if(i)host.appendChild(document.createElement("br"));if(p)host.appendChild(document.createTextNode(p))});
}
function link(host,label,url,depth){
  const safe=safeUrl(url);
  if(!safe){appendText(host,label===url?url:`${label} (${url})`);return}
  const a=el("a");a.href=safe;a.target="_blank";a.rel="noopener noreferrer";
  if(label===url)a.textContent=normalizeUrlText(label);else appendInline(a,label,depth+1);
  host.appendChild(a);
}

/* ---------- blocks ---------- */
function isBlockStart(line,next){
  return FENCE.test(line)||HEADING.test(line)||HR.test(line)||QUOTE.test(line)||LIST.test(line)||(line.includes("|")&&TABLE_SEP.test(next||""));
}
function splitRow(line){
  let s=line.trim();if(s.startsWith("|"))s=s.slice(1);if(s.endsWith("|")&&!s.endsWith("\\|"))s=s.slice(0,-1);
  return s.split(/(?<!\\)\|/).map(c=>c.trim().replace(/\\\|/g,"|"));
}
function renderBlocks(host,lines,opts,depth=0){
  let i=0;
  while(i<lines.length){
    const line=lines[i];
    if(!line.trim()){i++;continue}
    let m;
    if((m=line.match(FENCE))){
      const fence=m[1],lang=m[2]||"",body=[];i++;
      while(i<lines.length&&!(lines[i].trim().startsWith(fence[0].repeat(fence.length))&&lines[i].trim().replace(/[`~]/g,"")===""))body.push(lines[i++]);
      i++;host.appendChild(codeBlock(body.join("\n"),lang,opts));continue;
    }
    if((m=line.match(HEADING))){const h=el("h"+Math.min(4,m[1].length));appendInline(h,m[2]);host.appendChild(h);i++;continue}
    if(HR.test(line)){host.appendChild(el("hr"));i++;continue}
    if(QUOTE.test(line)){
      const inner=[];while(i<lines.length&&QUOTE.test(lines[i]))inner.push(lines[i++].match(QUOTE)[1]);
      const q=el("blockquote");if(depth<MAX_DEPTH)renderBlocks(q,inner,opts,depth+1);else appendText(q,inner.join("\n"));host.appendChild(q);continue;
    }
    if(line.includes("|")&&TABLE_SEP.test(lines[i+1]||"")){
      const head=splitRow(line);i+=2;const rows=[];
      while(i<lines.length&&lines[i].includes("|")&&lines[i].trim())rows.push(splitRow(lines[i++]));
      host.appendChild(table(head,rows));continue;
    }
    if(LIST.test(line)){
      const block=[];
      while(i<lines.length){
        const l=lines[i];
        if(LIST.test(l)||(/^\s{2,}\S/.test(l)&&block.length)){block.push(l);i++;continue}
        if(!l.trim()&&i+1<lines.length&&(LIST.test(lines[i+1])||/^\s{2,}\S/.test(lines[i+1]))){i++;continue}
        break;
      }
      host.appendChild(list(block,opts,depth));continue;
    }
    const para=[];
    while(i<lines.length&&lines[i].trim()&&!(para.length&&isBlockStart(lines[i],lines[i+1])))para.push(lines[i++]);
    const p=el("p");appendInline(p,para.join("\n"));host.appendChild(p);
  }
}
function list(block,opts,depth){
  const first=block[0].match(LIST),ordered=/\d/.test(first[2]),base=first[1].length;
  const root=el(ordered?"ol":"ul");
  if(ordered){const start=parseInt(first[2],10);if(start>1)root.start=start}
  let item=null,itemLines=[];
  const flush=()=>{
    if(!item)return;
    const own=[],nested=[];
    for(const l of itemLines){if(nested.length||(LIST.test(l)&&l.match(LIST)[1].length>base))nested.push(l);else own.push(l.trim())}
    let text=own.join("\n");const task=text.match(/^\[([ xX])\]\s+/);
    if(task){const box=el("input");box.type="checkbox";box.disabled=true;box.checked=task[1].toLowerCase()==="x";item.appendChild(box);item.appendChild(document.createTextNode(" "));text=text.slice(task[0].length)}
    appendInline(item,text);
    if(nested.length&&depth<MAX_DEPTH){const shift=Math.min(...nested.filter(l=>LIST.test(l)).map(l=>l.match(LIST)[1].length));item.appendChild(list(nested.map(l=>l.slice(Math.min(shift,l.length-l.trimStart().length))),opts,depth+1))}
    root.appendChild(item);
  };
  for(const l of block){
    const m=l.match(LIST);
    if(m&&m[1].length<=base){flush();item=el("li");itemLines=[m[3]]}
    else itemLines.push(l);
  }
  flush();
  return root;
}
function table(head,rows){
  const wrap=el("div","tableWrap"),t=el("table"),thead=el("thead"),tr=el("tr");
  head.forEach(c=>{const th=el("th");appendInline(th,c);tr.appendChild(th)});thead.appendChild(tr);t.appendChild(thead);
  const tb=el("tbody");
  rows.slice(0,400).forEach(r=>{const row=el("tr");for(let k=0;k<head.length;k++){const td=el("td");appendInline(td,r[k]??"");row.appendChild(td)}tb.appendChild(row)});
  t.appendChild(tb);wrap.appendChild(t);return wrap;
}
/* v5.11.19: чиста — ім'я файлу для кнопки «Завантажити» на code-блоці.
   Тільки безпечне розширення з білого списку, інакше .txt. */
function codeDownloadName(lang,idx){
  const ext=String(lang||"").toLowerCase().replace(/[^a-z0-9+#-]/g,"").slice(0,10);
  const safe={js:"js",mjs:"mjs",cjs:"cjs",ts:"ts",py:"py",html:"html",htm:"html",css:"css",json:"json",md:"md",sh:"sh",bash:"sh",sql:"sql",yaml:"yaml",yml:"yml",xml:"xml",txt:"txt",csv:"csv",java:"java",c:"c",cpp:"cpp",go:"go",rs:"rs",rb:"rb",php:"php",swift:"swift",kt:"kt",r:"r"};
  return `snippet-${Math.max(1,Number(idx)||1)}.${safe[ext]||"txt"}`;
}
function codeBlock(code,lang,opts){
  const box=el("div","codeBlock"),head=el("div","codeHead"),label=el("span",null,lang||"code"),btn=el("button","codeCopy",opts.copyLabel||"Copy");
  btn.type="button";
  btn.addEventListener("click",async()=>{
    try{await navigator.clipboard.writeText(code);btn.textContent=opts.copiedLabel||"Copied ✓";setTimeout(()=>{btn.textContent=opts.copyLabel||"Copy"},1200)}catch(e){btn.textContent="✗"}
  });
  // v5.11.19: кнопка «Завантажити» — зберігає код у .txt через Blob, жодного сервера.
  const dl=el("button","codeDownload",opts.downloadLabel||"Download");
  dl.type="button";
  dl.addEventListener("click",()=>{
    try{
      const blob=new Blob([code],{type:"text/plain;charset=utf-8"});
      const url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download=codeDownloadName(lang,++codeDlSeq);
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>{try{URL.revokeObjectURL(url)}catch(e){}},4000);
      dl.textContent=opts.downloadedLabel||"Saved ✓";
      setTimeout(()=>{dl.textContent=opts.downloadLabel||"Download"},1200);
    }catch(e){dl.textContent="✗"}
  });
  const actions=el("span","codeActions");actions.append(btn,dl);
  // v5.11.35: довгі блоки (>20 рядків) стартують згорнутими — кнопка
  // «Показати повністю (N)» / «Згорнути», aria-expanded, повага до
  // prefers-reduced-motion (CSS). Копіювання/завантаження не зачеплено.
  const lineCount=String(code).split("\n").length;
  if(lineCount>20){
    box.classList.add("codeCollapsed");
    const showLbl=n=>typeof opts.collapseShowLabel==="function"?opts.collapseShowLabel(n):("Show all ("+n+")");
    const tog=el("button","codeCollapse",showLbl(lineCount));
    tog.type="button";tog.setAttribute("aria-expanded","false");
    tog.addEventListener("click",()=>{
      const collapsed=box.classList.toggle("codeCollapsed");
      tog.setAttribute("aria-expanded",String(!collapsed));
      tog.textContent=collapsed?showLbl(lineCount):(opts.collapseHideLabel||"Collapse");
    });
    actions.append(tog);
  }
  head.append(label,actions);
  const pre=el("pre"),c=el("code",null,code);
  if(lang)c.setAttribute("data-lang",lang.slice(0,24));
  pre.appendChild(c);box.append(head,pre);return box;
}

function render(host,text,opts={}){
  if(!host)return;
  host.textContent="";
  let src=String(text??"").replace(/\r\n?/g,"\n").replace(/\u0000/g,"");
  let truncated=false;if(src.length>MAX_CHARS){src=src.slice(0,MAX_CHARS);truncated=true}
  host.classList.add("md");
  renderBlocks(host,src.split("\n"),opts,0);
  if(truncated)host.appendChild(el("p",null,"…"));
}
/* Plain-text view for copy/export: keeps the original Markdown source. */
function toPlain(text){return String(text??"")}

/* v5.11.19: потоковий рендер з пакетуванням.
   - повторні push() у межах одного кадру зливаються в ОДИН рендер (60fps на мобайлі);
   - рендер пропускається, якщо текст не змінився з минулого кадру;
   - перед важким рендером віддаємо керування через scheduler.yield(), якщо він є.
   Санітизація та сама, що в render(): тільки DOM-вузли, жодного innerHTML,
   посилання лише https. */
const __raf=typeof requestAnimationFrame==="function"?requestAnimationFrame:fn=>setTimeout(fn,16);
function createStreamRenderer(host,opts={}){
  let scheduled=false,pending=null,disposed=false,lastRendered=null;
  async function doRender(text){
    if(disposed)return;
    scheduled=false;
    const src=String(text??"");
    if(src===lastRendered)return; // незмінений текст — не перерендерюємо
    if(typeof scheduler!=="undefined"&&typeof scheduler.yield==="function"){try{await scheduler.yield()}catch(e){}}
    if(disposed)return;
    render(host,src,opts);
    lastRendered=src;
  }
  return{
    push(text){
      if(disposed)return;
      pending=String(text??"");
      if(scheduled)return;
      scheduled=true;
      __raf(()=>{const t=pending;pending=null;doRender(t)});
    },
    flush(){
      if(disposed)return;
      const t=pending;pending=null;scheduled=false;
      const src=String(t??lastRendered??"");
      if(src===lastRendered)return;
      render(host,src,opts);lastRendered=src;
    },
    get queued(){return scheduled},
    dispose(){disposed=true;pending=null;scheduled=false}
  };
}

g.AIBridgeMarkdown={render,createStreamRenderer,safeUrl,toPlain,normalizeUrlText,codeDownloadName};
})(globalThis);
