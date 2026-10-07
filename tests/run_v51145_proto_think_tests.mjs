/* v5.11.45 — URL protocol handler «web+ai-bridge://» + панель міркувань.
   1) parseProtoLink: чистий парсер ?proto=.
   2) manifest.webmanifest: protocol_handlers з web+ai-bridge.
   3) Ключі protoOpened/thinkLive/thinkDone в i18n.js (uk+en).
   4) Boot-обробник в app.js: parseProtoLink(location.search), toast protoOpened.
   5) renderAgentTrace: thinkPanel/thinkDone/thinkLive/thinkRunStart.
   6) styles.css: .thinkPanel, анімація thinkBreath, повага до prefers-reduced-motion. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),css=R("styles.css");
const manifest=JSON.parse(R("manifest.webmanifest"));

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grab(src,name){
  const m=src.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`,"m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name+" в app.js");
  return m[0];
}
(0,eval)(grab(app,"parseProtoLink"));

/* --- 1. parseProtoLink --- */
{
  ok(parseProtoLink("")===null,"порожній query → null");
  ok(parseProtoLink("?proto=")===null,"порожній proto → null");
  ok(parseProtoLink(null)===null,"null → null");
  ok(parseProtoLink("?proto=https%3A%2F%2Fexample.com")===null,"чужа схема → null");
  ok(parseProtoLink("?proto=%D0%BD%D0%B5%20url")===null,"сміття → null");
  ok(parseProtoLink("?proto=web%2Bai-bridge%3A%2F%2Fbogus")===null,"невідомий host → null");
  const c=parseProtoLink("?proto=web%2Bai-bridge%3A%2F%2Fchat%3Fq%3D%D0%BF%D1%80%D0%B8%D0%B2%D1%96%D1%82%20%D1%81%D0%B2%D1%96%D1%82");
  ok(c&&c.action==="chat"&&c.text==="привіт світ","chat?q= розпізнано (URL-decoded)");
  const cn=parseProtoLink("?proto=web%2Bai-bridge%3A%2F%2Fnew");
  ok(cn&&cn.action==="chat"&&cn.text==="","new без q → chat з порожнім текстом");
  const t=parseProtoLink("?proto=web%2Bai-bridge%3A%2F%2Fteam");
  ok(t&&t.action==="team","team → дія team");
  const up=parseProtoLink("?proto=web%2Bai-bridge%3A%2F%2FCHAT%3Fq%3Dhi");
  ok(up&&up.action==="chat"&&up.text==="hi","host у верхньому регістрі нормалізується");
  const sp=parseProtoLink("?proto=web%2Bai-bridge%3A%2F%2Fchat%3Fq%3D%20%20");
  ok(sp&&sp.action==="chat"&&sp.text==="","q лише з пробілів → порожній текст");
}

/* --- 2. manifest --- */
{
  const ph=manifest.protocol_handlers||[];
  const p=ph.find(x=>x.protocol==="web+ai-bridge");
  ok(!!p,"protocol_handlers: web+ai-bridge присутній");
  ok(p.url==="./?proto=%s","protocol_handlers url = ./?proto=%s");
}

/* --- 3. i18n ключі --- */
{
  ok(/protoOpened:"Посилання web\+ai-bridge/.test(i18n),"ключ protoOpened в uk");
  ok(/protoOpened:"web\+ai-bridge link/.test(i18n),"ключ protoOpened в en");
  ok(/thinkLive:"Міркування/.test(i18n),"ключ thinkLive в uk");
  ok(/thinkLive:"Reasoning/.test(i18n),"ключ thinkLive в en");
  ok(/thinkDone:"Продумано за \{s\}/.test(i18n),"ключ thinkDone в uk");
  ok(/thinkDone:"Thought for \{s\}s/.test(i18n),"ключ thinkDone в en");
}

/* --- 4. boot-обробник --- */
{
  ok(/parseProtoLink\(location\.search\)/.test(app),"boot: обробка ?proto=");
  ok(/t\("protoOpened"\)/.test(app),"toast з ключем protoOpened");
  ok(/cleanLaunchQuery\(\)/.test(app),"boot: очищення query після обробки");
}

/* --- 5. панель міркувань --- */
{
  ok(/thinkRunStart/.test(app),"thinkRunStart: замір початку прогону");
  ok(/thinkPanel/.test(app),"renderAgentTrace: details.thinkPanel");
  ok(/t\("thinkDone"/.test(app),"резюме після фінішу: thinkDone");
  ok(/t\("thinkLive"/.test(app),"живий стан під час прогону: thinkLive");
}

/* --- 6. CSS --- */
{
  ok(/\.thinkPanel\{/.test(css),"CSS: .thinkPanel");
  ok(/@keyframes thinkBreath/.test(css),"CSS: анімація thinkBreath");
  ok(/prefers-reduced-motion/.test(css),"CSS: повага до prefers-reduced-motion");
}

console.log(`\nPASS: ${passed} перевірок`);
