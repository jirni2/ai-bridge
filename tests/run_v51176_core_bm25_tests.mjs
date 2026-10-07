/* Тести ядра v5.11.76: answer() на BM25 (Okapi).
   Запуск: node tests/run_v51176_core_bm25_tests.mjs */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __PKG_VERSION = require('../bridge-version.json').version /* v5.11.92: було жорстко прописано шлях на машині автора */;
const C = require('../core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 200) : '')); }
}

ok('VERSION='+__PKG_VERSION, C.VERSION === __PKG_VERSION, C.VERSION);

/* 1. TF-saturation: речення з 5 згадками терміна вище за 2-слівне (стара формула брала коротке). */
{
  const ctx = 'Шторм насувався, шторм ревів, шторм ламав щогли, шторм топив човни, шторм не вщухав до ранку. Шторм минув. Матроси ремонтували щоглу вранці.';
  const r = C.answer('про що шторм?', ctx, 1);
  ok('bm25: tf-saturation — інформативне речення перше', r.length === 1 && r[0].includes('насувався'), r);
}

/* 2. Рідкісний термін важить більше за частий (IDF). */
{
  const ctx = 'Кіт спить на дивані. Собака спить у будці. Їжак спить взимку в норі під корінням старого дуба. Ведмідь спить взимку в барлозі.';
  const r = C.answer('де спить їжак взимку?', ctx, 1);
  ok('bm25: idf — речення з рідкісним «їжак» перше', r.length === 1 && r[0].includes('Їжак'), r);
}

/* 3. Стеммінг української морфології зберігся. */
{
  const ctx = 'Мрії витягують тебе з ями, коли ти впав. Не чекай ідеального моменту. Шторм не вічний.';
  const r = C.answer('що витягує з ями?', ctx, 1);
  ok('bm25: stemMatch — «витягує»/«витягують»', r.length === 1 && r[0].includes('ями'), r);
}

/* 4. Детермінізм: два виклики — той самий результат. */
{
  const ctx = 'Кіт спить на дивані. Собака спить у будці. Їжак спить взимку в норі.';
  const a = C.answer('де спить їжак?', ctx, 2);
  const b = C.answer('де спить їжак?', ctx, 2);
  ok('bm25: детермінізм', JSON.stringify(a) === JSON.stringify(b), { a, b });
}

/* 5. Топ-n — речення з оригіналу, у вихідному порядку. */
{
  const ctx = 'Кіт спить на дивані. Собака спить у будці. Їжак спить взимку в норі під корінням старого дуба. Ведмідь спить взимку в барлозі. Заєць бігає взимку по снігу.';
  const r = C.answer('де спить їжак взимку?', ctx, 2);
  const sents = C.splitSentences(ctx);
  ok('bm25: top-2 у вихідному порядку', r.length === 2 && sents.indexOf(r[0]) < sents.indexOf(r[1]), r);
  ok('bm25: результат — підмножина оригіналу', r.every(x => sents.includes(x)), r);
}

/* 6. Крайні випадки. */
ok('bm25: порожнє питання → []', C.answer('', 'Якийсь текст тут.', 2).length === 0);
ok('bm25: невідоме питання → [] без падіння', Array.isArray(C.answer('квантова гравітація', 'Мрії витягують тебе з ями.', 2)));
ok('bm25: n clamp ≤5', C.answer('де спить їжак?', 'Їжак спить. Кіт спить. Собака спить. Птах летить. Риба пливе. Змія повзе.', 99).length <= 5);
ok('bm25: oversize → CoreError', (() => { try { C.answer('q', 'x'.repeat(500001), 2); return false; } catch (e) { return e.isCoreError && e.code === 'tooLarge'; } })());

/* 7. EN/RU не зламались. */
{
  const en = C.answer('what powers the bridge engine?',
    'The bridge connects two river banks. Its engine is powered by local text analysis. No network calls are made.', 1);
  ok('bm25: en — знаходить речення про engine', en.length === 1 && /engine/i.test(en[0]), en);
  const ru = C.answer('кто построил мост?',
    'Мост соединяет два берега реки. Инженер построил мост за три года. Движение открыли весной.', 1);
  ok('bm25: ru — знаходить речення про міст', ru.length === 1 && ru[0].includes('мост'), ru);
}

/* 8. Цілісність і решта API не зачеплені. */
{
  const v = C.verifyIntegrity();
  ok('bm25: verifyIntegrity ok:true', v && v.ok === true, v);
  ok('bm25: summarize працює', C.summarize('Перше речення тут. Друге речення тут. Третє речення тут.', 2).length === 2);
  ok('bm25: analyze працює', C.analyze('Мрії витягують тебе з ями. Шторм не вічний.').lang === 'uk');
}

console.log(`\nbm25: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
