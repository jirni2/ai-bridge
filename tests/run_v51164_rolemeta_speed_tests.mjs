/* v5.11.64 — Бейдж ролі автора відповіді + жива швидкість генерації:
   1) estTokens: оцінка токенів (≈ символи/4), порожній текст → 0.
   2) providerSpeed: null для невдалих/без ms; {toks, ms, rate} для ок.
   3) speedFinalText: не падає без I18N (Node-оточення).
   4) Каркас: renderRoleBadge/renderSpeedRow/startSpeedLive/stopSpeedLive у app.js,
      wiring у renderAnswer і sendTask, roleName у currentRun/errRun/syncPayload,
      DOM-вузли в index.html, класи в styles.css, i18n uk+en (V51164). */
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
(0,eval)(`const t=(k)=>k;const fmtInt=(n)=>String(Math.round(Number(n)||0));\n${grabFn(app,"estTokens")}\n${grabFn(app,"providerSpeed")}\n${grabFn(app,"speedFinalText")}`);

/* --- 1. estTokens --- */
ok(estTokens("")===0,"порожній текст → 0 токенів");
ok(estTokens("abcd")===1,"4 символи → 1 токен");
ok(estTokens("a".repeat(400))===100,"400 символів → 100 токенів");
ok(estTokens("a".repeat(402))===101,"402 символи → 101 токен (округлення)");
ok(estTokens(null)===0,"null → 0");
ok(estTokens("x")===1,"1 символ → мінімум 1 токен");

/* --- 2. providerSpeed --- */
ok(providerSpeed(null)===null,"null → null");
ok(providerSpeed({ok:false,ms:1000,text:"abc"})===null,"невдалий результат → null");
ok(providerSpeed({ok:true,ms:0,text:"a".repeat(400)})===null,"ms=0 → null");
ok(providerSpeed({ok:true,ms:1000,text:""})===null,"порожній текст → null");
{
  const sp=providerSpeed({ok:true,ms:2000,text:"a".repeat(400)});
  ok(sp&&sp.toks===100&&sp.ms===2000,"toks=100, ms=2000");
  ok(sp&&sp.rate===50,"rate = 100/2с = 50 ток/с");
  const sp2=providerSpeed({ok:true,ms:333,text:"a".repeat(400)});
  ok(sp2&&typeof sp2.rate==="number"&&sp2.rate>290&&sp2.rate<310,"rate округлено до 0.1");
}

/* --- 3. speedFinalText без I18N --- */
ok(typeof speedFinalText({toks:100,ms:2000,rate:50})==="string","speedFinalText повертає рядок без I18N");

/* --- 4. каркас --- */
for(const fn of ["renderRoleBadge","renderSpeedRow","startSpeedLive","stopSpeedLive","estTokens","providerSpeed","speedFinalText"])
  ok(new RegExp(`^function ${fn}\\(`, "m").test(app),`app.js: function ${fn} існує`);
ok(/renderRoleBadge\(run\);/.test(app),"renderAnswer викликає renderRoleBadge(run)");
ok(/renderSpeedRow\(run\);/.test(app),"renderAnswer викликає renderSpeedRow(run)");
ok(/startSpeedLive\(\);/.test(app),"sendTask стартує живий таймер");
ok(/finally\{stopSpeedLive\(\);setBusy\(false\)\}/.test(app),"finally зупиняє таймер");
ok(/const roleAtSend=activeRole\(\);/.test(app),"sendTask фіксує роль на момент відправки");
ok(/roleName:roleAtSend\?\.name\|\|null/.test(app),"currentRun/errRun штампують roleName");
ok(/roleName:run\.roleName\|\|null/.test(app),"syncPayload несе roleName");
ok(/\$\{peerSpeed\(r\)\}/.test(app),"вкладка моделі рендерить peerSpeed(r)");
ok(/openSheet\("roleSheet"\)/.test(app),"тап по бейджу відкриває вибір ролі");
ok(html.includes('id="roleBadge"'),"index.html: #roleBadge");
ok(html.includes('id="speedRow"'),"index.html: #speedRow");
ok(css.includes(".roleBadge"),"styles.css: .roleBadge");
ok(css.includes(".speedRow"),"styles.css: .speedRow");
ok(css.includes(".speedChip"),"styles.css: .speedChip");

/* --- 5. i18n uk+en --- */
const pack=i18n.match(/const V51164=\{[\s\S]*?\n\};/);
ok(!!pack,"i18n.js: пак V51164 існує");
for(const k of ["roleBadgeTitle","roleBadgeAria","speedRow","speedLive","speedTab","speedTitle"]){
  const enPart=pack[0].split("uk:{")[0],ukPart=pack[0].split("uk:{")[1]||"";
  ok(enPart.includes(k+":"),`en: ${k}`);
  ok(ukPart.includes(k+":"),`uk: ${k}`);
}

console.log(`\nPASS: ${passed} перевірок v5.11.64`);
