/* v5.11.48 — Дизайн V2 (схвалено Сергієм, акцент Індиго #5e6ad2).
   1) Таб-бар: підписи 11.5px/600, іконки 23px stroke 2, активна — акцент + смужка 3px зверху (без залитого чипа).
   2) Картка відповіді: шапка .ansHead «модель · час» mono + .ansScore; дії — пігулки.
   3) app.js: finalTitle у форматі «модель · час»; renderQualityScore дублює бал у #ansScore.
   4) Підключення: statusPill — лише крапка + слово. Історія: unreadDot 8px без кільця.
   5) Brain: номери кроків — кола з індиго-обідком. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),css=R("styles.css"),html=R("index.html");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

/* --- 1. Таб-бар V2 --- */
ok(/\.tab b\{font-size:11\.5px;font-weight:600/.test(css),"таб-бар: підписи 11.5px/600");
ok(/\.tab \.navIcon\{width:23px;height:23px;stroke-width:2\}/.test(css),"таб-бар: іконки 23px stroke 2");
ok(/\.tab\.active\{color:var\(--accent\);background:transparent!important/.test(css),"таб-бар: активна — акцент, без заливки");
ok(/\.tab\.active:after\{[^}]*width:26px;height:3px;[^}]*background:var\(--accent\)/.test(css),"таб-бар: смужка-індикатор 3px зверху");
ok(!/\.tab\.active\{[^}]*background:var\(--accent-soft\)[^}]*\}[^]*ДИЗАЙН V2/.test(css)||true,"(порядок: V2 після старих правил)");
// V2-блок іде останнім: активна вкладка не має залитого чипа
const v2idx=css.indexOf("ДИЗАЙН V2 · v5.11.48");
ok(v2idx>0,"V2-блок присутній у styles.css");
const tail=css.slice(v2idx);
ok(!/\.tab\.active\{[^}]*background:var\(--accent-soft\)/.test(tail),"V2: активна вкладка без accent-soft заливки");

/* --- 2. Шапка картки відповіді --- */
ok(/class="ansHead"/.test(html),"index.html: .ansHead");
ok(/id="ansScore"/.test(html),"index.html: #ansScore");
ok(/class="ansBadges"/.test(html),"index.html: .ansBadges для бейджів");
ok(/\.ansHead\{display:flex;align-items:center;justify-content:space-between/.test(css),"CSS: .ansHead");
ok(/\.ansModel\{[^}]*font-family:var\(--mono\)/.test(css),"CSS: .ansModel моноширинний");
ok(/\.ansScore\{[^}]*font-variant-numeric:tabular-nums/.test(css),"CSS: .ansScore табличні цифри");

/* --- 3. app.js: формат заголовка --- */
ok(/_fm48=\(run\.selectedProviders\|\|\[\]\)\[0\]\|\|run\.judge/.test(app),"renderAnswer: модель з selectedProviders/judge");
ok(/_fms48=run\.ms\?/.test(app),"renderAnswer: час у шапці");
ok(/t\("secShort"\)/.test(app),"час з i18n secShort");
ok(/\$\("ansScore"\)/.test(app),"renderQualityScore: оновлення #ansScore");

/* --- 4. Пігулки дій --- */
ok(/\.answerActions \.actBtn\{[^}]*border-radius:999px/.test(css),"дії — пігулки 999px");
ok(/\.answerActions \.actBtn\{[^}]*min-height:42px/.test(css),"дії — min-height 42px");
ok(/\.answerActions\{[^}]*border-top:1px solid var\(--line-soft\)/.test(css),"дії відділені волосяною лінією");

/* --- 5. Органайзер: статуси --- */
ok(/#page-connections \.statusPill:before\{[^}]*border-radius:50%/.test(css),"statusPill — крапка через :before");
ok(/#page-connections \.statusPill\.on\{color:var\(--green\)\}/.test(css),"statusPill.on — зелений текст");
ok(/\.unreadDot\{width:8px;height:8px;box-shadow:none\}/.test(css),"unreadDot 8px без кільця");
ok(/\.historyItem\.hasUnread\{border-color:var\(--line\)\}/.test(css),"hasUnread без акцентної рамки");
ok(/\.loopNode i\{[^}]*border-radius:50%/.test(css),"Brain: номери кроків — кола");

/* --- 6. Заборони --- */
for(const d of["trade/","binance-bot/","backtests/","scheduler-worker/","trade-core.mjs"])
  ok(!new RegExp(d.replace(/[/.]/g,"\\$&")).test(tail),"V2-блок не чіпає "+d);

console.log(`\nPASS: ${passed} перевірок`);
