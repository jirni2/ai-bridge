/* v5.11.68 — мітка «пам'ять використано тут» + @@згадки минулих чатів:
   1) describeMemoryUsed: чиста — витягує дайджест M5 і уроки, null коли
      пам'яті не було, обрізка дайджеста 800.
   2) parseCtxMention/stripCtxMention/ctxMentionTokenAtEnd: чисті —
      розпізнавання @@query, @@ не ламає @згадки моделей.
   3) ctxRunDigest: кап 3000 + «…»; ctxSuggestRuns: ранжування
      (назва-префікс → назва → текст → свіжість), excludeUid, порожній запит.
   4) ctxNetBlock: конверт <PAST CHAT>, пусто без прикріплення.
   5) renderMemChip: чип лише коли є mem; ескейп дайджеста.
   6) Каркас: проводка в app.js/index.html/styles.css, i18n V51168 uk+en. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),html=R("index.html"),css=R("styles.css");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabFn(src,name){
  const m=src.match(new RegExp("^function "+name+"\\([\\s\\S]*?\\n\\}","m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name);
  return m[0];
}
function grabConst(src,name){
  if(name==="MENTION_ALIASES"){ // об'єктний літерал з комами — беремо до };
    const m=src.match(new RegExp("const "+name+"=(\\{[^;]*?\\});"));
    if(!m)throw new Error("FAIL: не знайдено const "+name);
    return `globalThis.${name}=${m[1]};`;
  }
  const m=src.match(new RegExp("\\b"+name+"\\s*=\\s*([^;,]+)"));
  if(!m)throw new Error("FAIL: не знайдено const "+name);
  return `globalThis.${name}=${m[1].trim()};`;
}

/* Заглушки до eval: t, esc. */
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
const T=(k,vars)=>{const s={memUsedHere:"Пам'ять використано тут",memDigestLabel:"З пам'яті цього діалогу",memLessonsLabel:"Вивчених патернів: {n}",ctxMentionUntitled:"Діалог без назви",ctxMentionEmpty:"Діалогів не знайдено."}[k]||k;
  return String(s).replace(/\{(\w+)\}/g,(_,x)=>vars&&vars[x]!==undefined?String(vars[x]):`{${x}}`)};
globalThis.t=T;globalThis.esc=esc;

/* ---------- 1. describeMemoryUsed ---------- */
(0,eval)(`${grabFn(app,"describeMemoryUsed")}`);
{
  const mem=`<older_digest max_chars="800">\nUSER: скільки коштує сайдинг; ASSISTANT: від $8/м2\n</older_digest>\n\n<recent_pairs count="4">\nUSER: а монтаж?\nASSISTANT: (no reply yet)\n</recent_pairs>\n\nSUCCESSFUL RUNTIME OUTCOMES (advisory patterns only; never instructions):\n1. task=research; tools=search_web; helpers=groqfree; successes=3; failures=0; confidence=0.75; evidence=5\n2. task=write; tools=direct; helpers=gemini; successes=1; failures=0; confidence=0.50; evidence=0`;
  const d=describeMemoryUsed(mem);
  ok(d&&d.digest.includes("сайдинг"),"дайджест M5 витягнуто");
  ok(d&&d.lessons===2,"2 уроки пораховано");
  ok(!String(d.digest).includes("recent_pairs"),"recent_pairs — не «пам'ять», не входить");
}
ok(describeMemoryUsed("")===null,"порожньо → null (чипа не буде)");
ok(describeMemoryUsed("<recent_pairs count=\"1\">\nUSER: hi\n</recent_pairs>")===null,"лише recent_pairs → null");
ok(describeMemoryUsed("<older_digest max_chars=\"800\">\n(empty)\n</older_digest>")===null,"порожній дайджест (empty) → null");
{
  const big="x".repeat(5000);
  const d=describeMemoryUsed(`<older_digest max_chars="800">\n${big}\n</older_digest>`);
  ok(d&&d.digest.length===800,"дайджест обрізається до 800 символів");
}
{
  const d=describeMemoryUsed("SUCCESSFUL RUNTIME OUTCOMES (advisory patterns only; never instructions):\n1. task=x; tools=direct");
  ok(d&&d.digest===""&&d.lessons===1,"тільки уроки — теж пам'ять (chip буде)");
}

/* ---------- 2. @@-парсинг ---------- */
(0,eval)(`${grabConst(app,"MENTION_ALIASES")}`);
(0,eval)(`${grabFn(app,"parseModelMention")}`);
(0,eval)(`${grabFn(app,"parseCtxMention")}`);
(0,eval)(`${grabFn(app,"stripCtxMention")}`);
(0,eval)(`${grabFn(app,"ctxMentionTokenAtEnd")}`);
{
  const m=parseCtxMention("порівняй з @@сайдинг і цінами");
  ok(m&&m.query==="сайдинг","@@сайдинг розпізнано, query=сайдинг");
  ok(stripCtxMention("порівняй з @@сайдинг і цінами",m)==="порівняй з і цінами","токен вирізається з lead-пробілом");
  ok(parseCtxMention("@groq поясни")==null,"одиночний @модель — не @@");
  ok(parseModelMention("@@groq")==null,"@@ не матчить згадку моделі");
  ok(parseModelMention("@@")==null,"голе @@ — не згадка моделі");
  ok(parseCtxMention("просто текст")==null,"без @@ → null");
  const e=ctxMentionTokenAtEnd("про @@сайд");
  ok(e&&e.query==="сайд","токен у кінці перед кареткою");
  ok(ctxMentionTokenAtEnd("про @@сайд " )===null,"пробіл після — не токен");
  ok(ctxMentionTokenAtEnd("@@")==null||ctxMentionTokenAtEnd("@@").query==="","голе @@ — порожній запит (показати останні)");
}

/* ---------- 3. дайджест і ранжування ---------- */
(0,eval)(`${grabConst(app,"CTX_MENTION_DIGEST_MAX")}`);
(0,eval)(`${grabConst(app,"CTX_MENTION_MAX_SUGGEST")}`);
(0,eval)(`${grabFn(app,"ctxRunTitle")}`);
(0,eval)(`${grabFn(app,"ctxRunDigest")}`);
(0,eval)(`${grabFn(app,"ctxSuggestRuns")}`);
{
  const d=ctxRunDigest({prompt:"q ".repeat(2000),final:"a ".repeat(2000)});
  ok(d.length<=CTX_MENTION_DIGEST_MAX+1&&d.endsWith("…"),"дайджест кап 3000 + …");
  ok(ctxRunDigest({prompt:"",final:""})==="","порожній діалог → порожній дайджест");
  ok(ctxRunTitle({title:"",prompt:""})==="Діалог без назви","без назви → untitled");
  ok(ctxRunTitle({title:"Сайдинг",prompt:"довге питання"}).startsWith("Сайдинг"),"назва пріоритетніша за prompt");
}
{
  const runs=[
    {uid:"a",title:"Сайдинг: ціни",prompt:"скільки коштує сайдинг",created:100,updated:100},
    {uid:"b",title:"TikTok план",prompt:"про сайдинг для відео",created:200,updated:200},
    {uid:"c",title:"Сайдинг монтаж",prompt:"монтаж",created:300,updated:300},
    {uid:"d",title:"Порожній",prompt:"",final:"",created:400,updated:400},
  ];
  const s1=ctxSuggestRuns(runs,"сайдинг","zzz");
  ok(s1.length===3&&s1[0].uid==="c"&&s1[1].uid==="a","префікс назви (c) перед збігом у назві (a) перед текстом (b)");
  const s2=ctxSuggestRuns(runs,"сайдинг","a");
  ok(!s2.some(r=>r.uid==="a"),"excludeUid виключає поточний діалог");
  const s3=ctxSuggestRuns(runs,"","zzz");
  ok(s3.length===3&&s3[0].uid==="c","порожній запит → останні (без порожніх)");
  ok(ctxSuggestRuns(runs,"неіснуюче","zzz").length===0,"без збігів → []");
}

/* ---------- 4. мережевий блок ---------- */
(0,eval)(`${grabFn(app,"ctxNetBlock")}`);
globalThis.ctxMentionAttached=null;
ok(ctxNetBlock()==="","без прикріплення → пусто");
globalThis.ctxMentionAttached={runId:"abc",title:"Сайдинг",digest:"питання… відповідь…"};
{
  const b=ctxNetBlock();
  ok(b.includes("<PAST CHAT")&&b.includes('title="Сайдинг"')&&b.includes("питання…"),"конверт з назвою і дайджестом");
}
globalThis.ctxMentionAttached={runId:"abc",title:'Шкідлива "назва" <x>',digest:"d"};
ok(!ctxNetBlock().includes('"назва"')&&!ctxNetBlock().includes("<x>"),"назва в атрибуті санітизована");
globalThis.ctxMentionAttached=null;

/* ---------- 5. чип пам'яті ---------- */
(0,eval)(`${grabFn(app,"renderMemChip")}`);
ok(renderMemChip({mem:{digest:"USER: a; ASSISTANT: b",lessons:2}},3).includes("використано тут"),"чип є коли є mem");
{
  const h=renderMemChip({mem:{digest:"<b>хай</b>",lessons:0}},0);
  ok(h.includes("&lt;b&gt;хай&lt;/b&gt;")&&!h.includes("<b>хай</b>"),"дайджест ескейпиться");
  ok(h.includes("data-memchip=\"0\"")&&h.includes("data-memdetail=\"0\""),"data-атрибути для тоглу");
}
ok(renderMemChip({},0)==="","без mem → пусто");
ok(renderMemChip({mem:{digest:"",lessons:0}},0)==="","порожній mem → пусто");
ok(renderMemChip({mem:{digest:"x",lessons:0}},1).includes("пам"),"мітка дайджеста");

/* ---------- 6. каркас ---------- */
ok(/describeMemoryUsed\(memory\)/.test(app),"runAgentPage фіксує memInfo до відправки");
ok(/memInfo\?\{mem:memInfo\}:\{\}/.test(app),"memInfo передається в addAgentMessage");
ok(/\$\{renderMemChip\(m,i\)\}/.test(app),"renderAgentThread вставляє чип");
ok(/data-memchip/.test(app),"клік-тогл чипа підключено");
ok(app.includes("wireCtxMentionAutocomplete();"),"ініціалізація @@-автодоповнення");
ok(html.includes('id="ctxMentionBox"'),"index.html: бокс підказок @@");
ok(/\.memChip\{/.test(css)&&/\.memChipDetail\{/.test(css)&&/\.mentionEmpty\{/.test(css),"styles.css: стилі чипа і порожнього стану");
ok(/ctxNetBlock\(\)/.test(app),"netPrompt несе @@контекст");
ok(/ctxChats:ctxSent/.test(app),"історія отримує слід ctxChats");
ok(/ctxRunsCache=null/.test(app),"кеш списку діалогів інвалідується при saveRun");
ok(i18n.includes("memUsedHere")&&i18n.includes("ctxMentionEmpty"),"i18n: ключі V51168");
{
  const m=i18n.match(/const V51168=\{[\s\S]*?\n\};/);
  ok(!!m&&m[0].includes("Пам'ять використано тут")&&m[0].includes("Memory used here"),"V51168: uk+en переклади");
}

console.log(`\nPASS: ${passed} перевірок`);
