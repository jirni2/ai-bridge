/* Тести ядра v5.11.91: analyze() — збалансований бюджет резюме по чанках
   (head/middle/tail ≈33/34/33, за зразком «Weighted Summaries»).
   Раніше summaryPool заповнювався тільки з перших 3 чанків — висновок довгого
   документа ніколи не потрапляв у резюме. Тепер: top-1 речення КОЖНОГО чанка,
   у резюме йдуть [перший, середній, останній]. ≤3 чанків — без змін.
   Запуск: node tests/run_v51191_core_chunkbudget_tests.mjs */
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
ok('composeBudgetedSummary експортовано', typeof C.composeBudgetedSummary === 'function');

/* --- Юніт: composeBudgetedSummary --- */
{
  const f = C.composeBudgetedSummary;
  ok('порожній вхід → []', JSON.stringify(f([])) === '[]');
  ok('1 чанк → як є', JSON.stringify(f(['a'])) === '["a"]');
  ok('3 чанки → ідентично старому', JSON.stringify(f(['a', 'b', 'c'])) === '["a","b","c"]');
  ok('4 чанки → [0,2,3]', JSON.stringify(f(['a', 'b', 'c', 'd'])) === '["a","c","d"]');
  ok('5 чанків → [0,2,4]', JSON.stringify(f(['a', 'b', 'c', 'd', 'e'])) === '["a","c","e"]');
  ok('6 чанків → [0,3,5]', JSON.stringify(f(['a', 'b', 'c', 'd', 'e', 'g'])) === '["a","d","g"]');
  ok('не-масив → []', JSON.stringify(f(null)) === '[]' && JSON.stringify(f('x')) === '[]');
  const src = ['a', 'b', 'c', 'd', 'e'];
  f(src);
  ok('вхідний масив не мутується', JSON.stringify(src) === '["a","b","c","d","e"]');
  ok('детермінізм', JSON.stringify(f(['a', 'b', 'c', 'd'])) === JSON.stringify(f(['a', 'b', 'c', 'd'])));
}

/* --- Інтеграція: analyze() на 4-чанковому документі --- */
function rep(s, n) { const a = []; for (let i = 0; i < n; i++) a.push(s.replace('{i}', i)); return a.join(' '); }
const ch0 = 'Початок звіту. ' + rep('Соняшник росте на полі номер {i}, соняшник дає добрий урожай щороку.', 1500);
const ch1 = rep('Трактор оре землю ділянки {i}, трактор працює від ранку до вечора.', 1500);
const ch2 = rep('Комбайн збирає зерно на полі {i}, комбайн не зупиняється в сезон.', 1500);
let ch3 = rep('Фінал сезону підбиває підсумки {i}, фінал робіт завершує рік.', 160);
ch3 += ' Фінал фінал фінал фінал фінал — МІШЕНЬ-ВИСНОВОК.';
const doc4 = ch0 + ' ' + ch1 + ' ' + ch2 + ' ' + ch3;

ok('документ справді 4-чанковий', doc4.length > 300000 && Math.ceil(doc4.length / 100000) === 4, doc4.length);
{
  const r = C.analyze(doc4);
  /* v5.11.93: частини ріжуться на межі слова — межі беремо з ядра, а не з кратних 100000. */
  const R4 = C.analyzeChunkRanges(doc4);
  ok('4 частини, розрізи на межі слова', R4.length === 4 && R4.slice(0, 3).every(([a, b]) => /\s/.test(doc4[b - 1])));
  ok('partial=true', r.partial === true);
  ok('summary — рівно 3 речення', r.summary.length === 3, r.summary.length);
  ok('позиція 0 = top-1 чанка 0 (початок збережено)',
    r.summary[0] === C.summarize(doc4.slice(...R4[0]), 1)[0]);
  ok('позиція 1 = top-1 середнього чанка (чанк 2)',
    r.summary[1] === C.summarize(doc4.slice(...R4[2]), 1)[0]);
  ok('позиція 2 = top-1 останнього чанка (висновок)',
    r.summary[2] === C.summarize(doc4.slice(...R4[3]), 1)[0]);
  ok('висновок потрапляє в резюме (мішень)', r.summary[2].includes('МІШЕНЬ-ВИСНОВОК'), r.summary[2]);
  ok('порядок — за документом', doc4.indexOf(r.summary[0]) < doc4.indexOf(r.summary[2]));
  ok('keywords присутні (10)', Array.isArray(r.keywords) && r.keywords.length === 10);
  ok('stats присутні', r.stats && r.stats.words > 0);
  const r2 = C.analyze(doc4);
  ok('детермінізм analyze', JSON.stringify(r.summary) === JSON.stringify(r2.summary));
}

/* --- 3 чанки: поведінка як раніше (перші 3 top-1) --- */
{
  const d0 = 'Початок звіту. ' + rep('Соняшник росте на полі номер {i}, соняшник дає добрий урожай щороку.', 1300);
  const d1 = rep('Трактор оре землю ділянки {i}, трактор працює від ранку до вечора.', 1300);
  const d2 = rep('Комбайн збирає зерно на полі {i}, комбайн не зупиняється в сезон.', 1300);
  const doc3 = d0 + ' ' + d1 + ' ' + d2;
  const r = C.analyze(doc3);
  ok('документ справді 3-чанковий', Math.ceil(doc3.length / 100000) === 3, doc3.length);
  const expected = C.analyzeChunkRanges(doc3).map(([a, b]) => C.summarize(doc3.slice(a, b), 1)[0]); /* v5.11.93: межі з ядра */
  ok('summary = top-1 чанків 0,1,2', JSON.stringify(r.summary) === JSON.stringify(expected));
}

/* --- Малий документ: не чанкована гілка без змін --- */
{
  const small = 'Кіт спить на дивані. Собака гавкає у дворі. Птахи співають вранці. Сонце світить яскраво.';
  const r = C.analyze(small);
  ok('partial=false', r.partial === false);
  ok('summary = summarize(t,3)', JSON.stringify(r.summary) === JSON.stringify(C.summarize(small, 3)));
}

/* --- Продуктивність: 400k не виходить за розумний час --- */
{
  const big = rep('Слово тест речення номер {i} для перевірки швидкості роботи аналізатора.', 6000);
  const t0 = Date.now();
  const r = C.analyze(big);
  const dt = Date.now() - t0;
  ok('400k аналізується < 8с', dt < 8000 && r.summary.length === 3, dt + 'мс');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
