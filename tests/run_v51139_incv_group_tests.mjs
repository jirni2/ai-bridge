/* v5.11.39 — дві ідеї scout:
   1) «Тимчасовий чат (інкогніто)»: перемикач #tempChatToggle, saveRun
      пропускає діалоги з meta.temporary (ні IndexedDB, ні usage, ні хмара),
      sendTask не створює pending-маркери, бейдж #tempBadge у шапці діалогу.
   2) «Групування історії за датами»: чисті histDayStart/histSectionKey/
      groupRunsByDate (сьогодні/вчора/7/30/старіші, за updated||created);
      renderHistory рендерить закріплені зверху поза секціями, секції —
      .histSection з i18n-підписами. i18n uk+en+ru, CSS тільки на токенах. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = fs.readFileSync(path.join(root, "app.js"), "utf8");
const i18nSrc = fs.readFileSync(path.join(root, "i18n.js"), "utf8");
const htmlSrc = fs.readFileSync(path.join(root, "index.html"), "utf8");
const cssSrc = fs.readFileSync(path.join(root, "styles.css"), "utf8");

let passed = 0;
function ok(v, msg) {
  if (!v) throw new Error("FAIL: " + msg);
  passed++;
  console.log("✓", msg);
}

/* Витягнення чистої функції з сирця (баланс дужок). */
function extractFunction(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("function not found: " + name);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("unbalanced braces in " + name);
}

/* Стаби: $ для tempChatOn; решта функцій чисті. (0,eval) — глобальна
   область, тому стаби — через globalThis. */
let stubChecked = false, stubMissing = false;
globalThis.$ = id => {
  if (id === "tempChatToggle") return stubMissing ? null : {checked: stubChecked};
  return null;
};
globalThis.HIST_SECTION_ORDER = ["today", "yesterday", "last7", "last30", "older"];
const sandbox = [
  extractFunction(appSrc, "histDayStart"),
  extractFunction(appSrc, "histSectionKey"),
  extractFunction(appSrc, "groupRunsByDate"),
  extractFunction(appSrc, "tempChatOn"),
].join("\n");
(0, eval)(sandbox);

/* ---- 1. histSectionKey: межі секцій (фіксований "зараз") ---- */
const NOW = new Date(2026, 9, 2, 12, 0, 0).getTime(); // п'ятниця, локальний час
const D = 86400000, TS = histDayStart(NOW);
ok(histDayStart(NOW) === new Date(2026, 9, 2, 0, 0, 0).getTime(), "histDayStart = початок локальної доби");
const cases = [
  [TS, "today"], [TS + 3600000, "today"], [NOW, "today"],
  [TS - 1, "yesterday"], [TS - D, "yesterday"], [TS - D + 1, "yesterday"],
  [TS - 2 * D, "last7"], [TS - 7 * D, "last7"],
  [TS - 7 * D - 1, "last30"], [TS - 8 * D, "last30"], [TS - 30 * D, "last30"],
  [TS - 30 * D - 1, "older"], [TS - 400 * D, "older"],
  [0, "older"], [undefined, "older"], [null, "older"], [NaN, "older"],
];
for (const [created, want] of cases) {
  ok(histSectionKey(created, NOW) === want, `histSectionKey(${String(created)}) = ${want}`);
}

/* ---- 2. groupRunsByDate: 5 секцій у порядку, updated має пріоритет ---- */
const mk = (id, created, extra = {}) => ({id, created, ...extra});
const runs = [
  mk("a", NOW - 1000),
  mk("b", TS - D + 5000),
  mk("c", TS - 3 * D),
  mk("d", TS - 10 * D),
  mk("e", TS - 100 * D),
  mk("f", TS - 100 * D, {updated: NOW - 2000}), // старий created, свіжий updated -> today
];
const groups = groupRunsByDate(runs, NOW);
ok(groups.length === 5, "5 непорожніх секцій");
ok(groups.map(g => g.key).join(",") === "today,yesterday,last7,last30,older", "порядок секцій: today..older");
ok(groups[0].items.map(r => r.id).join(",") === "a,f", "updated має пріоритет над created (f у today), спадний порядок всередині");
ok(groups[1].items[0].id === "b" && groups[4].items[0].id === "e", "розкладка по секціях");
ok(groupRunsByDate([], NOW).length === 0, "порожній список -> []");
ok(groupRunsByDate(null, NOW).length === 0, "null -> []");
// всередині секції — спадний порядок за updated||created
const g2 = groupRunsByDate([mk("x", TS - 5 * D), mk("y", TS - 2 * D), mk("z", TS - 6 * D)], NOW);
ok(g2.length === 1 && g2[0].key === "last7" && g2[0].items.map(r => r.id).join(",") === "y,x,z", "сортування всередині секції за спаданням");

/* ---- 3. tempChatOn ---- */
stubChecked = true; stubMissing = false;
ok(tempChatOn() === true, "tempChatOn: чекбокс увімкнено");
stubChecked = false;
ok(tempChatOn() === false, "tempChatOn: чекбокс вимкнено");
stubMissing = true;
ok(tempChatOn() === false, "tempChatOn: елемента немає -> false");

/* ---- 4. Статичні перевірки тимчасового діалогу в app.js ---- */
ok(appSrc.includes("if(run?.meta?.temporary)return null;"), "saveRun: ранній вихід для temporary (ні IndexedDB, ні usage, ні хмара)");
ok(appSrc.includes("if(!tempRun)savePendingJob("), "sendTask: temp не створює pending-маркер");
ok(appSrc.includes("if(!tempRun)savePendingPayload("), "sendTask: temp не зберігає pending-payload");
ok(appSrc.includes("if(tempRun)errRun.meta.temporary=true;"), "errRun позначається temporary");
ok(appSrc.includes("if(tempRun)currentRun.meta.temporary=true;"), "currentRun позначається temporary");
ok(appSrc.includes('const tb=$("tempBadge");') && appSrc.includes('t("tempChatBadge")'), "renderAnswer: бейдж tempBadge з i18n");
ok(appSrc.includes('$("tempBadge")?.classList.add("hidden")'), "newTask: бейдж ховається для нового діалогу");
// research/vision з увімкненим інкогніто теж не пишуться
ok((appSrc.match(/if\(tempChatOn\(\)\)run\.meta\.temporary=true;/g) || []).length === 2, "research і vision позначають temporary");

/* ---- 5. Статичні перевірки групування в renderHistory ---- */
ok(appSrc.includes("groupRunsByDate(runs.filter(r=>!isPinned(pinnedRunIds,r.id)),Date.now())"), "renderHistory: групує тільки незакріплені");
ok(appSrc.includes("pinnedItems.map(histItemHtml).join(\"\")+"), "renderHistory: закріплені — зверху поза секціями");
ok(appSrc.includes('class="histSection histSecToggle') && appSrc.includes("HIST_SECTION_LABEL[g.key]"), "renderHistory: заголовки секцій з i18n-ключами (кнопка-згортання v5.11.42)");

/* ---- 6. i18n: блок V51139, uk+en+ru ---- */
const forStmt = 'for(const [lang,strings] of Object.entries(V51139)){if(lang==="en")Object.assign(EN,strings);else if(PACKS[lang])Object.assign(PACKS[lang],strings)}';
ok(i18nSrc.includes("const V51139={") && i18nSrc.includes(forStmt), "блок V51139 в i18n.js");
const vStart = i18nSrc.indexOf("const V51139={");
const vBlock = i18nSrc.slice(vStart, i18nSrc.indexOf(forStmt) + forStmt.length);
globalThis.EN = {};
globalThis.PACKS = {uk: {}, ru: {}, en: globalThis.EN};
(0, eval)(vBlock);
const EN = globalThis.EN, PACKS = globalThis.PACKS;
const keys = ["tempChatTitle", "tempChatHint", "tempChatBadge", "histSecToday", "histSecYesterday", "histSecLast7", "histSecLast30", "histSecOlder"];
for (const k of keys) {
  ok(EN[k], "i18n en: " + k);
  ok(PACKS.uk[k], "i18n uk: " + k);
  ok(PACKS.ru[k], "i18n ru: " + k);
}
ok(PACKS.uk.tempChatBadge === "Тимчасовий" && PACKS.uk.histSecToday === "Сьогодні", "uk-значення");
ok(PACKS.ru.tempChatBadge === "Временный" && PACKS.ru.histSecLast30 === "Предыдущие 30 дней", "ru-значення");
ok(EN.tempChatBadge === "Temporary" && EN.histSecYesterday === "Yesterday", "en-значення");

/* ---- 7. index.html ---- */
ok(htmlSrc.includes('id="tempBadge" class="tempBadge hidden"'), "#tempBadge у шапці відповіді");
ok(htmlSrc.includes('id="tempChatToggle" type="checkbox"'), "#tempChatToggle у Налаштуваннях композера");
ok(htmlSrc.includes('data-i18n="tempChatTitle"') && htmlSrc.includes('data-i18n="tempChatHint"'), "data-i18n для перемикача");

/* ---- 8. styles.css: класи + тільки токени ---- */
for (const cls of [".histSection", ".tempBadge", ".tempToggleRow"]) {
  ok(cssSrc.includes(cls), "CSS: " + cls);
}
const v51139css = cssSrc.slice(cssSrc.indexOf("/* v5.11.39:"));
ok(!/#[0-9a-fA-F]{3,8}\b/.test(v51139css), "CSS v5.11.39: жодних hex-кольорів поза токенами");
ok(v51139css.includes("var(--mono)") && v51139css.includes("var(--violet)"), "CSS: mono caps для секцій, violet для інкогніто");

console.log("\nPASS: " + passed + " checks (v5.11.39 incognito + history grouping)");
