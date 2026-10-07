/* v5.11.28: довга вставка → вкладення + картка-цитата PNG.
   1) expandPasteMarkers: чиста, розгортає маркери в текст, невідомі id лишає.
   2) stripMdForCard: чиста, знімає markdown-розмітку.
   3) Клієнт: paste-обробник на трьох полях, поріг 5000, sessionStorage,
      розгортання в sendTask/agent/research, кнопки картки (чат + агент + cmdk).
   4) i18n: нові ключі в en/uk/ru. */
import fs from "node:fs";
const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const i18n=fs.readFileSync(new URL("../i18n.js",import.meta.url),"utf8");
let passed=0;const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)};

function extractFn(src,name){
  const start=src.indexOf("function "+name+"(");
  if(start<0)throw new Error("no function "+name);
  const end=src.indexOf("\n}\n",start);
  if(end<0)throw new Error("no end for "+name);
  return src.slice(start,end+2);
}
const PASTE_MARK_RE=/paste:([0-9a-f]{8})/g;
const tShim=(k,vars)=>({pasteBlockHead:`вкладений текст «${vars?.name}»`,pasteFileName:`вставка-текст-${vars?.time}.txt`,pasteNameFallback:"вставка.txt",pasteUnitOne:"знак",pasteUnitFew:"знаки",pasteUnitMany:"знаків"}[k]??k);
function loadFn(name){
  const code=extractFn(app,name);
  return new Function("PASTE_MARK_RE","t",code+`;return ${name};`)(PASTE_MARK_RE,tShim);
}
const expandPasteMarkers=loadFn("expandPasteMarkers");
const stripMdForCard=loadFn("stripMdForCard");
const pasteCharsUnit=loadFn("pasteCharsUnit");

/* --- 1. expandPasteMarkers --- */
const store=new Map([["a1b2c3d4",{name:"вставка-текст-120000.txt",chars:8,text:"ДОВГИЙТЕКСТ"}]]);
const withMark="питання [📎 вставка-текст-120000.txt · 8 знаків · paste:a1b2c3d4] кінець";
const expanded=expandPasteMarkers(withMark,store);
ok(expanded.includes("ДОВГИЙТЕКСТ"),"маркер розгортається в повний текст");
ok(expanded.includes("вкладений текст"),"розгорнутий блок має підпис-ім'я");
ok(!/paste:a1b2c3d4/.test(expanded),"id маркера зникає з мережевого тексту");
ok(expandPasteMarkers("без маркерів",store)==="без маркерів","текст без маркерів не чіпається");
const unknown=expandPasteMarkers("x paste:deadbeef y",store);
ok(unknown.includes("[paste:deadbeef]"),"невідомий id лишається читабельним маркером");
ok(expandPasteMarkers("",store)==="","порожній рядок -> порожній");
ok(pasteCharsUnit(1)==="знак","1 знак");
ok(pasteCharsUnit(2)==="знаки","2 знаки");
ok(pasteCharsUnit(5)==="знаків","5 знаків");
ok(pasteCharsUnit(11)==="знаків","11 знаків");
ok(pasteCharsUnit(21)==="знак","21 знак");
ok(pasteCharsUnit(22)==="знаки","22 знаки");
ok(pasteCharsUnit(111)==="знаків","111 знаків");

/* --- 2. stripMdForCard --- */
const md="# Заголовок\n**жирний** і `код` [лінк](https://x.test) текст\n> цитата\n- пункт\n1. нумер";
const plain=stripMdForCard(md);
ok(!/[#*`>\[\]()]/.test(plain.replace(/•/g,"")),"розмітка знята: "+JSON.stringify(plain.slice(0,60)));
ok(plain.includes("Заголовок")&&plain.includes("жирний")&&plain.includes("лінк"),"зміст збережено");
ok(stripMdForCard("```js\nconst a=1;\n```")==="const a=1;","code-fence -> чистий код");
ok(stripMdForCard("").trim()==="","порожнє -> порожнє");

/* --- 3. клієнтське вбудовування --- */
ok(/const PASTE_ATTACH_CHARS=5000/.test(app),"поріг вставки 5000 символів");
ok(/\["prompt","agentPrompt","filePrompt"\]/.test(app),"paste-обробник на трьох полях вводу");
ok(/ai_bridge_paste_store_v1/.test(app)&&/sessionStorage/.test(app),"сховище вставок — sessionStorage");
ok(/const netPrompt=expandPasteMarkers\(/.test(app),"sendTask розгортає маркери в мережевий промпт");
ok(/const promptExpanded=expandPasteMarkers\(prompt\)/.test(app),"перевірка розміру — по розгорнутому тексту");
ok(/const goalExpanded=expandPasteMarkers\(goal\)/.test(app),"сторінка агента розгортає маркери");
ok(/return runResearch\(expandPasteMarkers\(prompt\)(\+ctxBlock)?\)/.test(app),"research-шлях розгортає маркери");
ok(/displayPrompt:prompt/.test(app),"displayPrompt лишається з коротким маркером");
ok(/sweepPasteStore\(\)/.test(app),"сховище чиститься після відправки");
ok(/function makeQuoteCardBlob\(text\)/.test(app),"рендер картки 1080x1920 на canvas");
ok(/1080/.test(app)&&/1920/.test(app),"розмір картки 1080×1920");
ok(/fillText\("P\.S\.M"/.test(app),"підпис P.S.M на картці");
ok(/function downloadQuoteCard\(sourceText,scopeId\)/.test(app),"downloadQuoteCard з вибором фрагмента");
ok(/data-agent-card=/.test(app),"кнопка картки на повідомленнях агента");
ok(/id="quoteCardBtn"/.test(html)&&/data-i18n="quoteCardBtn"/.test(html),"кнопка Картка PNG у меню відповіді");
ok(/label:t\("quoteCardBtn"\)/.test(app),"команда картки в палітрі ⌘K");
ok(!/html2canvas|dom-to-image/.test(app),"без сторонніх бібліотек для картки");

/* --- 4. i18n en+uk+ru --- */
const NEW=["pasteAsAttachment","quoteCardBtn","quoteCardSaved","quoteCardFail","quoteCardEmpty","pasteFileName","pasteNameFallback","pasteBlockHead","pasteUnitOne","pasteUnitFew","pasteUnitMany"];
for(const k of NEW){
  const c=(i18n.match(new RegExp(`\\b${k}:`,"g"))||[]).length;
  ok(c>=3,`i18n ${k} в en/uk/ru (${c})`);
}
console.log(`PASS ${passed} checks`);
