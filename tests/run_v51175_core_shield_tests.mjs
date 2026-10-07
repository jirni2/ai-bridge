/* Тести «Захист Ядра» v5.11.75: DoS-ліміти, цілісність, safe-обгортки, санітизація.
   Запуск: node tests/run_v51175_core_shield_tests.mjs */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __PKG_VERSION = require('../bridge-version.json').version /* v5.11.92: було жорстко прописано шлях на машині автора */;
const C = require('../core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; /* console.log('PASS: ' + name); */ }
  else { fail++; console.log('FAIL: ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 200) : '')); }
}

const UK = "Мрії витягують тебе з ями, коли ти впав. Не чекай ідеального моменту. Шторм не вічний.";

/* Версія */
ok('VERSION='+__PKG_VERSION, C.VERSION === __PKG_VERSION, C.VERSION);
ok('MAX_INPUT_CHARS=500000', C.MAX_INPUT_CHARS === 500000, C.MAX_INPUT_CHARS);
ok('TIME_BUDGET_MS=10000', C.TIME_BUDGET_MS === 10000, C.TIME_BUDGET_MS);

/* 1. DoS-ліміт: guardInput */
ok('guardInput: межа 500k проходить', C.guardInput("x".repeat(500000)).length === 500000);
let tooLarge = null;
try { C.guardInput("x".repeat(500001)); } catch (e) { tooLarge = e; }
ok('guardInput: 500001 кидає CoreError', !!tooLarge && tooLarge.isCoreError === true && tooLarge.code === 'tooLarge', tooLarge && tooLarge.code);

/* DoS-ліміт через публічні функції — чесна помилка, не зависання */
for (const [fname, args] of [
  ['summarize', ["x".repeat(500001), 2]],
  ['analyze', ["x".repeat(500001)]],
  ['answer', ["питання", "x".repeat(500001), 2]],
  ['keywords', ["x".repeat(500001), 5]],
  ['stats', ["x".repeat(500001)]],
  ['detectLang', ["x".repeat(500001)]],
  ['splitSentences', ["x".repeat(500001)]],
  ['tokenize', ["x".repeat(500001)]],
]) {
  let e = null;
  try { C[fname](...args); } catch (err) { e = err; }
  ok(fname + ': oversize → CoreError(tooLarge)', !!e && e.isCoreError && e.code === 'tooLarge', e && e.code);
}

/* 2. Цілісність */
const v0 = C.verifyIntegrity();
ok('verifyIntegrity: чисте завантаження ok:true', v0 && v0.ok === true && v0.expected === v0.actual, v0);
ok('verifyIntegrity: хеш 8 hex-символів', /^[0-9a-f]{8}$/.test(v0.expected), v0.expected);
/* Симуляція підміни в рантаймі */
const origSummarize = C.summarize;
C.summarize = function () { return ['hacked']; };
const v1 = C.verifyIntegrity();
ok('verifyIntegrity: підміна детектиться (ok:false)', v1 && v1.ok === false && v1.actual !== v1.expected, v1);
C.summarize = origSummarize;
const v2 = C.verifyIntegrity();
ok('verifyIntegrity: після відновлення знову ok:true', v2 && v2.ok === true, v2);

/* 3. Safe-обгортки: дивні входи не роняють (не кидають назовні) */
ok('analyze(null) → валідний порожній результат', (() => { const r = C.analyze(null); return r && r.stats.words === 0 && Array.isArray(r.keywords); })());
ok('analyze(undefined) → валідний порожній результат', (() => { const r = C.analyze(undefined); return r && r.stats.words === 0; })());
ok('summarize(null) → []', Array.isArray(C.summarize(null)) && C.summarize(null).length === 0);
ok('answer(null,null) → []', Array.isArray(C.answer(null, null)) && C.answer(null, null).length === 0);
ok('keywords(12345) → масив', Array.isArray(C.keywords(12345, 3)));
ok('stats({}) → обʼєкт без винятку', typeof C.stats({}) === 'object' && typeof C.stats({}).words === 'number');
ok('detectLang(null) → en', C.detectLang(null) === 'en');
ok('splitSentences(42) → масив', Array.isArray(C.splitSentences(42)));
ok('tokenize(null) → []', Array.isArray(C.tokenize(null)) && C.tokenize(null).length === 0);

/* Safe-обгортка: внутрішній виняток (не CoreError) → fallback, не падіння */
ok('analyze(throwing toString) → error-фолбек', (() => {
  const evil = { toString() { throw new Error('boom'); } };
  const r = C.analyze(evil);
  return r && r.error === true && r.stats.words === 0 && Array.isArray(r.summary);
})());
ok('summarize(throwing toString) → []', (() => {
  const evil = { toString() { throw new Error('boom'); } };
  const r = C.summarize(evil, 2);
  return Array.isArray(r) && r.length === 0;
})());

/* 4. Санітизація виводу */
ok('escapeHtml: <>&"\'', C.escapeHtml('<script>alert("x")</script>') === '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
ok('escapeHtml: & → &amp;', C.escapeHtml('a&b') === 'a&amp;b');
ok('escapeHtml: null → ""', C.escapeHtml(null) === '');
ok('escapeHtml: звичайний текст без змін', C.escapeHtml('Привіт, світе!') === 'Привіт, світе!');

/* 5. Частковий аналіз великих текстів */
const big = "Кіт спить. ".repeat(15000); /* ~150k символів */
const rb = C.analyze(big);
ok('analyze(150k): partial=true', rb.partial === true, rb.partial);
ok('analyze(150k): stats.words>0', rb.stats.words > 1000, rb.stats.words);
ok('analyze(150k): summary непорожнє', Array.isArray(rb.summary) && rb.summary.length > 0);
ok('analyze(150k): keywords 1..10', Array.isArray(rb.keywords) && rb.keywords.length > 0 && rb.keywords.length <= 10, rb.keywords.length);
const small = C.analyze(UK);
ok('analyze(малий): partial=false', small.partial === false);
ok('analyze(малий): без error', !small.error);

/* 6. ReDoS-аудит: ключові regex без вкладених квантифікаторів */
/* Небезпечний патерн: (X+)+, (X*)*, (X+)* з перекривними класами. */
function hasNestedQuantifier(src) {
  /* шукаємо групу, всередині якої квантифікатор, і після групи теж квантифікатор */
  return /\([^()]*[+*][^()]*\)[+*]/.test(src);
}
const keyFns = ['splitSentences', 'tokenize', 'detectLang'];
let redosClean = true, redosDetail = '';
for (const fn of keyFns) {
  const src = C[fn].toString();
  /* витягти всі regex-літерали з джерела функції */
  const lits = src.match(/\/(?:\\.|[^\/\\])+\/[gimsuy]*/g) || [];
  for (const lit of lits) {
    if (hasNestedQuantifier(lit)) { redosClean = false; redosDetail = fn + ': ' + lit; }
  }
}
ok('ReDoS: базові функції без вкладених квантифікаторів', redosClean, redosDetail);

/* 7. Базові функції не зламані захистом */
ok('summarize: звичайний текст', C.summarize(UK, 2).length === 2);
ok('answer: звичайний текст', C.answer("що витягує з ями?", UK, 1).length >= 1);
ok('detectLang: uk', C.detectLang(UK) === 'uk');
ok('stats: слова', C.stats(UK).words > 5);

console.log(`\nshield: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
