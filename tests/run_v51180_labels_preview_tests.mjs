/* v5.11.80 — живі мітки міркувань + згорнуті прев'ю результатів інструментів:
   1) THINK_LABEL_KEYS (6 ключів) + чиста thinkLabelKey(i) — ротація по колу.
   2) startThinkLabels/stopThinkLabels: таймер 3.8с, текст у #progressText,
      зупинка при конкретній фазі / reconnect / stopActivity.
   3) captureProgressLine пропускає мітки (thinkLabelsOn) — не смітять журнал.
   4) setState: processing без фази → startThinkLabels(); конкретна фаза,
      searching_web, resubmitting → stopThinkLabels().
   5) toolExcerptParts (чиста): короткий → {preview, full:null}, довгий →
      прев'ю 280+… з full; порожній → null.
   6) renderAgentTrace: рядки містять toolPreviewHtml(x).
   7) styles.css: .toolPreview / .toolPreviewMore / .toolPreviewFull.
   8) _worker.js: attachTraceExcerpt(trace,step,text), ліміт 1500, виклики
      у гілках search_web / delegate / fetch_url.
   9) i18n V51180: thinkLabel0..5 + toolPreviewMore в en і uk.
   Запуск: node tests/run_v51180_labels_preview_tests.mjs */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),css=R("styles.css"),worker=R("_worker.js");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabFn(src,name){
  const m=src.match(new RegExp("^(?:async )?function "+name+"\\([\\s\\S]*?\\n\\}","m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name);
  return m[0];
}

/* ---------- 1. ключі міток ---------- */
{
  const m=app.match(/^const THINK_LABEL_KEYS=\[([^\]]*)\];/m);
  ok(m,"THINK_LABEL_KEYS існує");
  const keys=eval("["+m[1]+"]");
  ok(keys.length===6&&keys[0]==="thinkLabel0"&&keys[5]==="thinkLabel5","6 ключів thinkLabel0..thinkLabel5");
  const fnM=app.match(/function thinkLabelKey\(i\)\{return ([^}]*)\}/);
  ok(fnM,"thinkLabelKey існує");
  const thinkLabelKey=eval(`(i)=>{const THINK_LABEL_KEYS=${JSON.stringify(keys)};return ${fnM[1]}}`);
  ok(thinkLabelKey(0)==="thinkLabel0","key(0)=thinkLabel0");
  ok(thinkLabelKey(5)==="thinkLabel5","key(5)=thinkLabel5");
  ok(thinkLabelKey(6)==="thinkLabel0","key(6) — ротація по колу");
  ok(thinkLabelKey(11)==="thinkLabel5","key(11) — ротація");
  ok(thinkLabelKey(-1)==="thinkLabel5","key(-1) — від'ємний індекс");
  ok(thinkLabelKey("x")==="thinkLabel0","key('x') — нечисло → 0");
}

/* ---------- 2. start/stop міток ---------- */
{
  const st=grabFn(app,"startThinkLabels");
  ok(st.includes("$(\"progressText\")"),"startThinkLabels пише в #progressText");
  ok(st.includes("setInterval(tick,3800)"),"інтервал ротації 3.8с");
  ok(st.includes("thinkLabelsOn=true"),"прапорець thinkLabelsOn=true");
  ok(/if\(thinkLabelTimer\)return/.test(st),"повторний старт не плодить таймерів");
  const sp=grabFn(app,"stopThinkLabels");
  ok(sp.includes("thinkLabelsOn=false")&&sp.includes("clearInterval"),"stopThinkLabels скидає прапорець і таймер");
}

/* ---------- 3. журнал не смітиться ---------- */
{
  const c=grabFn(app,"captureProgressLine");
  ok(c.includes("if(thinkLabelsOn)return"),"captureProgressLine пропускає мітки");
  const sa=grabFn(app,"stopActivity");
  ok(sa.includes("stopThinkLabels()"),"stopActivity зупиняє мітки");
}

/* ---------- 4. setState ---------- */
{
  const s=grabFn(app,"sendTask");
  ok(s.includes("stopThinkLabels();$(\"progressTitle\").textContent=t(\"taskReconnect\")"),"resubmitting зупиняє мітки");
  ok(/searching_web[\s\S]{0,200}?stopThinkLabels\(\); \/\/ v5\.11\.80/.test(s),"searching_web зупиняє мітки");
  ok(s.includes("if(state===\"processing\"&&!progress?.phase)startThinkLabels();"),"processing без фази → старт міток");
  ok(s.includes("else{stopThinkLabels();$(\"progressText\").textContent=map[1]}"),"інші стани → стоп міток + статичний текст");
}

/* ---------- 5. toolExcerptParts ---------- */
{
  const src=grabFn(app,"toolExcerptParts");
  const toolExcerptParts=eval(`(${src})`);
  ok(toolExcerptParts("")===null,"порожній уривок → null");
  ok(toolExcerptParts("   ")===null,"пробіли → null");
  const short=toolExcerptParts("короткий результат");
  ok(short&&short.preview==="короткий результат"&&short.full===null,"короткий → preview, full=null");
  const long=toolExcerptParts("x".repeat(300));
  ok(long&&long.full.length===300&&long.preview.length===281&&long.preview.endsWith("…"),"довгий → прев'ю 280+… з full");
  const custom=toolExcerptParts("y".repeat(120),100);
  ok(custom&&custom.full.length===120&&custom.preview.length===101,"кастомний ліміт 100");
  const exact=toolExcerptParts("z".repeat(280));
  ok(exact&&exact.full===null,"рівно 280 → без full");
  const pv=grabFn(app,"toolPreviewHtml");
  ok(pv.includes("toolExcerptParts(x?.excerpt)"),"toolPreviewHtml читає x.excerpt");
  ok(pv.includes("toolPreviewMore")&&pv.includes("<details"),"довгий → <details> з кнопкою");
  ok(pv.includes('esc('),"уривок екранується через esc()");
}

/* ---------- 6. renderAgentTrace ---------- */
{
  const r=grabFn(app,"renderAgentTrace");
  ok(r.includes("${toolPreviewHtml(x)}"),"рядки траси містять toolPreviewHtml(x)");
}

/* ---------- 7. CSS ---------- */
{
  ok(css.includes(".toolPreview{")||css.includes(".toolPreview {"),"клас .toolPreview");
  ok(css.includes(".toolPreviewMore"),"клас .toolPreviewMore");
  ok(css.includes(".toolPreviewFull"),"клас .toolPreviewFull");
  ok(/\.toolPreview summary\{[^}]*min-height:44px/.test(css),"summary ≥44px тач-ціль");
}

/* ---------- 8. _worker.js: уривки в трасу ---------- */
{
  ok(/const AGENT_TRACE_EXCERPT_MAX=1500;/.test(worker),"ліміт уривка 1500");
  const a=worker.match(/const attachTraceExcerpt=\(step,text\)=>\{[\s\S]*?\n  \};/);
  ok(a,"attachTraceExcerpt існує");
  ok(a[0].includes("te.excerpt")&&a[0].includes("slice(0,AGENT_TRACE_EXCERPT_MAX)"),"записує te.excerpt з лімітом");
  ok(a[0].includes("replace(/\\s+/g,\" \")"),"нормалізує пробіли");
  ok(/attachTraceExcerpt\(step,\(Array\.isArray\(found\.results\)/.test(worker),"search_web → уривок з результатів");
  ok(/if\(delegated\)\{observations\.push\([\s\S]*?\}\);attachTraceExcerpt\(step,delegated\.text\)\}/.test(worker),"delegate → уривок з тексту");
  ok(worker.includes("attachTraceExcerpt(step,((page.title?")&&worker.includes("(page.text||\"\")))"),"fetch_url → уривок з тексту сторінки");
  ok(!/te\.excerpt=.*observations/.test(a[0]),"уривок не тягне весь observation");
}

/* ---------- 9. i18n ---------- */
{
  ok(i18n.includes("const V51180="),"пак V51180 існує");
  for(const k of ["thinkLabel0","thinkLabel1","thinkLabel2","thinkLabel3","thinkLabel4","thinkLabel5","toolPreviewMore"]){
    ok(new RegExp(k+":\"").test(i18n),"ключ "+k+" присутній");
  }
  const ukPack=i18n.match(/uk:\{thinkLabel0:"([^"]*)"/);
  ok(ukPack&&/Розбираю/.test(ukPack[1]),"uk thinkLabel0 українською");
  ok(/uk:\{[^}]*toolPreviewMore:"Читати повністю"/.test(i18n),"uk toolPreviewMore = «Читати повністю»");
  const enPack=i18n.match(/en:\{thinkLabel0:"([^"]*)"/);
  ok(enPack&&/Parsing/.test(enPack[1]),"en thinkLabel0 англійською");
}

console.log(`\nALL PASS: ${passed} checks`);
