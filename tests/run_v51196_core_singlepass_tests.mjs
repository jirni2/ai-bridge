/* Тести ядра v5.11.96: analyze() — ОДИН прохід на чанк (__analyzeChunk).
   Старий цикл викликав на кожен чанк stats(chunk) [splitSentences+tokenize],
   tokenize(chunk) [частоти] і summarize(chunk,1) [splitSentences+tokenize+по реченнях]:
   разом 2× splitSentences і 3× tokenize. Тепер: один splitSentences + один tokenize,
   статистика/частоти/top-1 — з тих самих даних за тими самими формулами
   (архітектурний прийом за зразком wink-nlp: токенізувати один раз у спільну
   колекцію, далі всі стадії працюють на ній). Результат має бути побайтово
   ідентичний старому багато-прохідному циклу.
   Запуск: node tests/run_v51196_core_singlepass_tests.mjs */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __PKG_VERSION = require('../bridge-version.json').version;
const C = require('../core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

ok('VERSION=' + __PKG_VERSION, C.VERSION === __PKG_VERSION, C.VERSION);
ok('verifyIntegrity', C.verifyIntegrity().ok === true);

/* --- Референс: старий багато-прохідний цикл, зібраний ТІЛЬКИ з публічного API.
   Єдина частина, що її не можна відтворити публічно — внутрішнє групування
   __groupWordForms; для неї окремий точний тест нижче (ключові слова). */
function refOldAnalyze(text) {
  const t = C.guardInput(text);
  const CHUNK = 100000;
  if (t.length <= CHUNK) {
    return { lang: C.detectLang(t), stats: C.stats(t), keywords: C.keywords(t, 10),
             summary: C.summarize(t, 3), partial: false, truncated: false };
  }
  const lang = C.detectLang(t.slice(0, 10000));
  const agg = { chars: 0, words: 0, sentences: 0, uniq: new Set(), sLenW: 0, sLenN: 0, wLenW: 0, wLenN: 0, complexity: 0 };
  const perChunkTop = [];
  for (const [from, to] of C.analyzeChunkRanges(t)) {
    const chunk = t.slice(from, to);
    const st = C.stats(chunk);
    agg.chars += st.chars; agg.words += st.words; agg.sentences += st.sentences;
    agg.sLenW += st.avgSentenceLen * st.sentences; agg.sLenN += st.sentences;
    agg.wLenW += st.avgWordLen * st.words; agg.wLenN += st.words;
    if (st.complexity > agg.complexity) agg.complexity = st.complexity;
    for (const w of C.tokenize(chunk)) agg.uniq.add(w);
    const one = C.summarize(chunk, 1); if (one.length) perChunkTop.push(one[0]);
  }
  return {
    lang,
    stats: {
      chars: agg.chars, words: agg.words, sentences: agg.sentences,
      avgSentenceLen: agg.sLenN ? +((agg.sLenW / agg.sLenN).toFixed(1)) : 0,
      avgWordLen: agg.wLenN ? +((agg.wLenW / agg.wLenN).toFixed(1)) : 0,
      uniqueWords: agg.uniq.size, complexity: agg.complexity
    },
    summary: C.composeBudgetedSummary(perChunkTop),
    partial: true, truncated: false
  };
}

function rep(s, n) { const a = []; for (let i = 0; i < n; i++) a.push(s.replace('{i}', i)); return a.join(' '); }
const docA = rep('Соняшник росте на полі номер {i}, соняшник дає добрий урожай щороку.', 6000); // ~418k, 5 чанків
const docB = rep('Початок. ', 1500) + rep('Середина з числами 12345 і поштою test@example.com, речення {i} містить деталі.', 5500) + rep('Кінець. ', 1500);
const docSmall = 'Маленький документ. Два речення для нечанкованої гілки.';

/* --- stats: побайтова рівність з референсом --- */
for (const [nm, d] of [['docA', docA], ['docB', docB]]) {
  const a = C.analyze(d), r = refOldAnalyze(d);
  ok(nm + ': stats ідентичні', eq(a.stats, r.stats), a.stats);
  ok(nm + ': summary ідентичні', eq(a.summary, r.summary), a.summary);
  ok(nm + ': lang/partial/truncated ідентичні',
    a.lang === r.lang && a.partial === r.partial && a.truncated === r.truncated);
}
/* нечанкована гілка — без змін */
{
  const a = C.analyze(docSmall), r = refOldAnalyze(docSmall);
  ok('малий документ: повна рівність', eq(a, r));
}

/* --- keywords: точний end-to-end тест накопичення частот.
   20 різних слів (різняться першою літерою → stemMatch їх не зливає, групування —
   тотожність), кожне слово[i] зустрічається (20-i)*S разів. Очікуваний топ —
   строго за спаданням лічильника. Документ >100k → чанкована гілка. */
{
  const W = ['альфа','бета','вега','гамма','дельта','епсілон','єнот','жираф','земля','игрек',
             'йод','квант','лямбда','мюон','нейтрон','омега','піон','ротор','сигма','тау'];
  const S = 80, parts = [];
  for (let i = 0; i < W.length; i++) {
    const sent = (W[i] + ' ').repeat(20 - i).trim() + '.';
    for (let k = 0; k < S; k++) parts.push(sent);
  }
  const doc = parts.join(' ');
  ok('kw-документ чанкований', doc.length > 100000, doc.length);
  const kw = C.analyze(doc).keywords;
  const expected = W.slice(0, 10).map((w, i) => ({ word: w, count: (20 - i) * S }));
  ok('keywords: топ-10 точно за лічильниками', eq(kw, expected), kw);
}

/* --- крайові випадки --- */
ok('порожній рядок', eq(C.analyze('').summary, []) && C.analyze('').stats.chars === 0);
{
  const p = C.analyze('... !!! ??? ...');
  ok('лише пунктуація: без падіння', Array.isArray(p.summary) && p.stats.sentences >= 0);
}
{
  // один чанк, одне речення на чанк → top = саме речення
  const one = 'Одне речення. ' + rep('Продовження речення номер {i} без крапок всередині', 2500);
  const a = C.analyze(one), r = refOldAnalyze(one);
  ok('довгий текст: stats/summary як референс', eq(a.stats, r.stats) && eq(a.summary, r.summary));
}
{
  const d1 = JSON.stringify(C.analyze(docA)), d2 = JSON.stringify(C.analyze(docA));
  ok('детермінізм analyze()', d1 === d2);
}

/* --- перфоманс: новий analyze() не повільніший за 0.85× старого циклу
   (замір в одному процесі, медіана з 5; ручний A/B дав ~0.42×) --- */
{
  const med = (fn) => { const ts = []; for (let k = 0; k < 5; k++) { const t0 = Date.now(); fn(); ts.push(Date.now() - t0); } ts.sort((x, y) => x - y); return ts[2]; };
  const tNew = med(() => C.analyze(docA));
  const tOld = med(() => refOldAnalyze(docA));
  ok('швидше за старий цикл (new=' + tNew + 'ms old=' + tOld + 'ms)', tNew <= tOld * 0.85, { tNew, tOld });
}

console.log(fail === 0 ? 'v5.11.96 core single-pass tests PASS (' + pass + ')' : 'v5.11.96 tests FAILED: ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
