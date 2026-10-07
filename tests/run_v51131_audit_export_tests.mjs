/* v5.11.31: хеш-ланцюговий журнал подій (tamper-evident audit) + експорт діалогу (md/json).
   1) _worker.js: teamEventCanon (канонічний рядок), teamEventHash (SHA-256 hex),
      teamEventsVerifyChain (ok / розрив / legacy / межа), роут GET /api/team/events з chain,
      нові функції в експортному списку.
   2) Клієнт: exportDialogMdText / exportDialogJsonText (формат, екранування),
      chainRow (4 гілки), експорт JSONL у crew.js, wiring кнопок.
   3) i18n: 8 ключів V51131 × 3 мови; CSS: блок v5.11.31 тільки на токенах, без hex.
   Екстрактор — підрахунок дужок (урок v5.11.30: наївний regex-grab ламається). */
import fs from "node:fs";
import {createHash} from "node:crypto";
const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const crew=fs.readFileSync(new URL("../crew.js",import.meta.url),"utf8");
const worker=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const i18n=fs.readFileSync(new URL("../i18n.js",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../styles.css",import.meta.url),"utf8");
let passed=0;const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)};

/* --- екстрактор з підрахунком дужок --- */
function extractFn(src,name){
  const re=new RegExp("function\\s+"+name+"\\s*\\(");
  const m=re.exec(src);
  if(!m)throw new Error("no function "+name);
  let start=m.index;
  if(src.slice(Math.max(0,start-6),start)==="async ")start-=6; /* не втрачати async */
  let i=src.indexOf("{",m.index);
  if(i<0)throw new Error("no body for "+name);
  let depth=0,j=i;
  for(;j<src.length;j++){
    const c=src[j];
    if(c==="{")depth++;
    else if(c==="}"){depth--;if(depth===0)break}
  }
  if(depth!==0)throw new Error("unbalanced braces in "+name);
  return src.slice(start,j+1);
}
function loadFn(src,name,extra={}){
  const code=extractFn(src,name);
  const names=Object.keys(extra),vals=Object.values(extra);
  return new Function(...names,code+`;return ${name};`)(...vals);
}

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function loadFnAsync(src,name,extra={}){
  const code=extractFn(src,name);
  const names=Object.keys(extra),vals=Object.values(extra);
  return await new AsyncFunction(...names,code+`;return ${name};`)(...vals);
}

/* --- 1. teamEventCanon: канонічний рядок --- */
const teamEventCanon=loadFn(worker,"teamEventCanon");
ok(teamEventCanon({prev:"GENESIS",ts:100,kind:"task",actor:"team",msg:"hello"})==="GENESIS|100|task|team|hello","canon: повний запис");
ok(teamEventCanon({ts:5,kind:"info",actor:"u",msg:"m"}).startsWith("GENESIS|5|"),"canon: без prev → GENESIS");
ok(teamEventCanon({prev:"abc",ts:1,kind:"k",actor:"a",msg:"x|y"})==="abc|1|k|a|x|y","canon: вертикальна риска в msg не екранується (канонічно)");

/* --- 2. teamEventHash: SHA-256 hex, збігається з node:crypto --- */
const teamEventHash=await loadFnAsync(worker,"teamEventHash");
const h1=await teamEventHash("GENESIS|100|task|team|hello");
ok(h1===createHash("sha256").update("GENESIS|100|task|team|hello","utf8").digest("hex"),"hash: збігається з node:crypto");
ok(/^[0-9a-f]{64}$/.test(h1),"hash: 64 hex-символи");
ok(await teamEventHash("")===createHash("sha256").update("","utf8").digest("hex"),"hash: порожній рядок");

/* --- 3. teamEventsVerifyChain: ланцюг, розрив, legacy, межа --- */
const teamEventsVerifyChain=loadFn(worker,"teamEventsVerifyChain");
async function seal(prev,ts,kind,actor,msg){
  const rec={ts,kind,actor,msg,prev};
  rec.h=await teamEventHash(teamEventCanon(rec));
  return rec;
}
const r1=await seal("GENESIS",1000,"task","team","created");
const r2=await seal(r1.h,1001,"task","team","started");
const r3=await seal(r2.h,1002,"task","team","done");
let v=teamEventsVerifyChain([r1,r2,r3],null);
ok(v.ok===true&&v.chained===3&&v.legacy===0&&v.brokenAt===null,"verify: чистий ланцюг 3 → ok/chained 3");
const tamperedPrev={...r3,prev:"deadbeef"};
v=teamEventsVerifyChain([r1,r2,tamperedPrev],null);
ok(v.ok===false&&v.chained===2&&v.brokenAt===1002,"verify: підміна prev у 3-му → розрив на ts=1002");
const tamperedH={...r2,h:"0".repeat(64)};
v=teamEventsVerifyChain([r1,tamperedH,r3],null);
ok(v.ok===false&&v.chained===2&&v.brokenAt===1002,"verify: підміна h у 2-му → розрив зв'язності на 3-му");
const tamperedMsg={...r2,msg:"hacked"};
ok(await teamEventHash(teamEventCanon(tamperedMsg))!==r2.h,"verify: підміна msg ловиться повною перевіркою canon→h");
v=teamEventsVerifyChain([{ts:1,kind:"x",actor:"a",msg:"old1"},{ts:2,kind:"x",actor:"a",msg:"old2"},r1,r2,r3],null);
ok(v.ok===true&&v.chained===3&&v.legacy===2&&v.brokenAt===null,"verify: 2 legacy на початку + ланцюг GENESIS → ok, legacy 2");
v=teamEventsVerifyChain([r1,r2,r3],"wrong-boundary");
ok(v.ok===false&&v.chained===0&&v.brokenAt===1000,"verify: невірна межа → розрив на першому записі");
v=teamEventsVerifyChain([r1,r2,r3],"GENESIS");
ok(v.ok===true&&v.chained===3,"verify: межа GENESIS еквівалентна відсутності");
const b1=await seal("BOUNDARY-HASH",2000,"task","team","after-trim");
const b2=await seal(b1.h,2001,"task","team","next");
v=teamEventsVerifyChain([b1,b2],"BOUNDARY-HASH");
ok(v.ok===true&&v.chained===2,"verify: ланцюг від межі витіснення → ok");
v=teamEventsVerifyChain([{ts:1,msg:"a"},{ts:2,msg:"b"}],null);
ok(v.ok===true&&v.chained===0&&v.legacy===2,"verify: все legacy → не помилка");
v=teamEventsVerifyChain([],null);
ok(v.ok===true&&v.chained===0&&v.legacy===0,"verify: порожній масив → ok");
v=teamEventsVerifyChain(null,null);
ok(v.ok===true&&v.chained===0,"verify: null → ok");

/* --- 4. сервер: роут і експорти --- */
ok(/sub===\"\/events\"&&m===\"GET\"\)return json\(\{version:VERSION,events:await teamEventList\(env,q\.get\("limit"\)\),chain:await teamEventsVerify\(env\)\}\)/.test(worker),"роут GET /api/team/events повертає {events, chain}");
for(const fn of ["teamEventCanon","teamEventHash","teamEventsVerifyChain","teamEventSeal","teamEventsVerify"]){
  ok(new RegExp(`\\b${fn}\\b`).test(worker.slice(worker.indexOf("/* v5.11.0 team exports */"))),`експортний список: ${fn}`);
}
ok(/const evicted=ev\[ev\.length-201\];[\s\S]{0,160}teamPut\(env,"events:boundary"/.test(worker),"teamEventLog: межа events:boundary при витісненні");
const telBody=extractFn(worker,"teamEventLog");
ok(/containsSecretLike/.test(telBody)&&/\[redacted:possible-secret\]/.test(telBody),"журнал: санітизація через containsSecretLike, без сирих секретів");

/* --- 5. exportDialogMdText: формат --- */
const tFake=(k,vars)=>{let s=DICT[k]||k;for(const[a,b]of Object.entries(vars||{}))s=String(s).replace("{"+a+"}",String(b));return s};
const DICT={qualityScore:"Оцінка: {n}",exportDlgTask:"Завдання",exportDlgAnswer:"Відповідь",exportDlgModels:"Моделі",exportDlgSources:"Джерела"};
const exportDialogMdText=loadFn(app,"exportDialogMdText",{
  UI_VERSION:"5.11.31",
  I18N:{locale:()=>"uk-UA",getLanguage:()=>"uk"},
  PROVIDERS:{groq:{name:"Groq"},gemini:{name:"Gemini"}},
  fmtMoney:(n)=>{const v=Number(n)||0;return (v>0&&v<0.01)?"<0.01":v.toFixed(v<10?4:2)},
  t:tFake,
  safeSourceUrl:(u)=>u,
  dialogStamp:()=>"TESTSTAMP",
});
const run={
  prompt:"Поясни [квантову] фізику\nдругий рядок",
  final:"Відповідь текстом.",
  created:1727865600000,
  mode:"auto",
  providers:["groq","gemini"],
  results:[{provider:"groq",ms:1200,ok:true,costUsd:0.42},{provider:"gemini",ms:3400,ok:false,costUsd:null}],
  meta:{qualityScore:{avg:4.2},webSearch:{results:[{title:"Джерело [1]",url:"https://example.com/x"}]}},
};
const md=exportDialogMdText(run,{version:"5.11.31",dateStr:"02.10.2026"});
ok(md.name==="ai-bridge-dialog-TESTSTAMP.md","md: ім'я файлу з dialogStamp");
ok(md.text.startsWith("# Поясни квантову фізику"),"md: title — перший рядок, без дужок [ ]");
ok(md.text.includes("## Завдання")&&md.text.includes("## Відповідь"),"md: секції Завдання/Відповідь");
ok(md.text.includes("## Моделі"),"md: секція Моделі");
ok(/- Groq: 1200 ms ≈\$0\.4200, ok/.test(md.text),"md: рядок моделі з чипом ціни");
ok(/- Gemini: 3400 ms, err/.test(md.text),"md: рядок моделі без ціни, статус err");
ok(md.text.includes("Оцінка: 4,2"),"md: оцінка Judge з комою (uk)");
ok(md.text.includes("## Джерела")&&md.text.includes("1. [Джерело 1](https://example.com/x)"),"md: джерела, title без дужок");
ok(md.text.includes("AI Bridge v5.11.31"),"md: футер з версією");
const mdNoExtra=exportDialogMdText({prompt:"p",final:"f",created:1});
ok(!mdNoExtra.text.includes("## Моделі")&&!mdNoExtra.text.includes("## Джерела")&&!mdNoExtra.text.includes("Оцінка"),"md: без results/quality/sources — секцій немає");

/* --- 6. exportDialogJsonText: повна структура --- */
const exportDialogJsonText=loadFn(app,"exportDialogJsonText",{dialogStamp:()=>"TESTSTAMP"});
const js=exportDialogJsonText(run);
ok(js.name==="ai-bridge-dialog-TESTSTAMP.json","json: ім'я файлу");
const parsed=JSON.parse(js.text);
ok(parsed.prompt===run.prompt&&parsed.final===run.final&&parsed.results.length===2&&parsed.meta.qualityScore.avg===4.2,"json: повна структура run, валідний JSON");

/* --- 7. chainRow: 4 гілки --- */
const chainRow=loadFn(crew,"chainRow",{
  state:{},
  t:(k,vars)=>{const d={crewChainOk:"Ланцюг цілісності: ✓ перевірено ({n} записів)",crewChainBroken:"Ланцюг цілісності: ✗ розрив на записі {at}",crewChainLegacy:"{legacy} записів без хеша (до верифікації)"};let s=d[k]||k;for(const[a,b]of Object.entries(vars||{}))s=s.replace("{"+a+"}",String(b));return s},
  esc:(s)=>String(s),
});
function chainRowWith(chain){
  const code=extractFn(crew,"chainRow");
  return new Function("state","t","esc",code+";return chainRow;")({chain},tFake2,(s)=>String(s))();
  function tFake2(k,vars){const d={crewChainOk:"Ланцюг цілісності: ✓ перевірено ({n} записів)",crewChainBroken:"Ланцюг цілісності: ✗ розрив на записі {at}",crewChainLegacy:"{legacy} записів без хеша (до верифікації)"};let s=d[k]||k;for(const[a,b]of Object.entries(vars||{}))s=s.replace("{"+a+"}",String(b));return s}
}
ok(chainRow()==="","chainRow: без chain → порожньо");
ok(chainRowWith({ok:true,chained:200,legacy:0,brokenAt:null}).includes("✓ перевірено (200 записів)"),"chainRow: ok → ✓ (200 записів)");
ok(chainRowWith({ok:true,chained:5,legacy:3,brokenAt:null}).includes("3 записів без хеша"),"chainRow: ok + legacy → допис про legacy");
ok(chainRowWith({ok:false,chained:7,legacy:0,brokenAt:1728000000}).includes("✗ розрив на записі 1728000000"),"chainRow: розрив → ✗ з brokenAt");
ok(chainRowWith({ok:false,chained:1,legacy:0,brokenAt:5}).includes('class="crew-chain bad"'),"chainRow: розрив → клас bad");
ok(chainRowWith({ok:true,chained:1,legacy:0,brokenAt:null}).includes('class="crew-chain ok"'),"chainRow: ok → клас ok");

/* --- 8. crew.js: експорт JSONL і статус у renderEvents --- */
ok(/function exportEventsJsonl\(\)\{[\s\S]{0,300}application\/jsonl/.test(crew),"crew: exportEventsJsonl — Blob application/jsonl");
ok(/ai-bridge-events-/.test(crew),"crew: JSONL — ім'я ai-bridge-events-");
ok(/JSON\.stringify\(e\)/.test(crew),"crew: JSONL — кожен запис одним рядком");
ok(crew.includes("crewEventsExportBtn")&&/t\(.{0,2}"crewEventsExport".{0,2}\)/.test(crew),"crew: кнопка експорту з i18n-підписом");
ok(/state\.chain=jEv&&jEv\.chain\?jEv\.chain:null/.test(crew),"crew: refresh читає jEv.chain");
ok(/chainRow\(\)/.test(crew),"crew: renderEvents вставляє chainRow()");

/* --- 9. app.js/index.html: wiring експорту діалогу --- */
ok(/id="exportDialogMdBtn"/.test(html)&&/id="exportDialogJsonBtn"/.test(html),"index.html: кнопки exportDialogMdBtn/exportDialogJsonBtn");
ok(/data-i18n="exportDialogMd"/.test(html)&&/data-i18n="exportDialogJson"/.test(html),"index.html: підписи через i18n");
ok(/\$\("exportDialogMdBtn"\)/.test(app)&&/downloadExportFile\("md"\)/.test(app),"app.js: wiring md-кнопки");
ok(/\$\("exportDialogJsonBtn"\)/.test(app)&&/downloadExportFile\("json"\)/.test(app),"app.js: wiring json-кнопки");
ok(/new Blob\(\[out\.text\],\{type:"text\/markdown/.test(app)&&/type:"application\/json"/.test(app),"app.js: MIME-типи md/json");
ok(!/Експорт JSONL|Ланцюг цілісності|Діалог \(\.md\)/.test(app.slice(app.indexOf("function exportDialogMdText"),app.indexOf("function downloadExportFile"))),"app.js: український UI-текст у нових функціях — тільки через t()");

/* --- 10. i18n: 8 ключів × 3 мови --- */
const v31=i18n.slice(i18n.indexOf("const V51131="));
for(const k of ["crewChainOk","crewChainBroken","crewChainLegacy","crewEventsExport","exportDialogMd","exportDialogMdDesc","exportDialogJson","exportDialogJsonDesc","exportDlgTask","exportDlgAnswer","exportDlgModels","exportDlgSources"]){
  ok(i18n.includes(k+':"'),`i18n: ключ ${k} присутній (V51131/V51131b)`);
}
ok(/uk:\{[\s\S]*?crewChainOk:"Ланцюг цілісності: ✓ перевірено/.test(v31),"i18n uk: crewChainOk");
ok(/ru:\{[\s\S]*?crewChainOk:"Цепочка целостности: ✓ проверено/.test(v31),"i18n ru: crewChainOk");
ok(/en:\{[\s\S]*?exportDialogJson:"Dialog \(\.json\)"/.test(v31),"i18n en: exportDialogJson");

/* --- 11. CSS: блок v5.11.31 тільки на токенах --- */
const cssBlock=css.slice(css.indexOf("/* v5.11.31:"));
ok(cssBlock.length>150,"styles.css: блок v5.11.31 присутній");
ok(/\.crew-chain\{/.test(cssBlock),"CSS: .crew-chain");
ok(/\.crew-chain\.ok\{/.test(cssBlock)&&/\.crew-chain\.bad\{/.test(cssBlock),"CSS: .crew-chain.ok/.bad");
ok(!/#[0-9a-fA-F]{3,8}\b/.test(cssBlock),"CSS: жодних hex-кольорів у новому блоці");
ok(!/style=/.test(cssBlock),"CSS: жодних інлайн-стилів у новому блоці");
ok(/var\(--/.test(cssBlock),"CSS: кольори через var(--токени)");

console.log(`\n${passed} checks passed`);
