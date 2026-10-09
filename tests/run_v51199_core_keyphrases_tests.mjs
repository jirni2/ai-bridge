/* Тести ядра v5.11.99: keyphrases() — витяг багатослівних ключових фраз за RAKE.
   Прийом з інших проєктів (rake-js, оригінал Rose et al. 2010): кандидати =
   максимальні послідовності змістовних токенів, розділені стоп-словами й межами
   речень; score(w)=deg(w)/freq(w) (deg — сума довжин кандидатів зі словом);
   оцінка фрази = сума оцінок слів. Альтернативу YAKE (5 статистичних ознак,
   складніша формула) відкинуто: RAKE простіший, детермінований, O(n), ідеально
   лягає на наявний набір STOP (uk/en/ru) і правила tokenize().
   Нова функція доповнює keywords() (одиночні токени) і summarize() (речення);
   analyze() НЕ чіпано — побайтова сумісність збережена.
   Запуск: node tests/run_v51199_core_keyphrases_tests.mjs */
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
ok('keyphrases в експорті', typeof C.keyphrases === 'function');

/* --- Ручний RAKE-розрахунок (канонічний приклад).
   Текст: "Machine learning is great. Machine learning algorithms change the world."
   Стоп-слова: is, the. Кандидати: [machine,learning] [great] [machine,learning,algorithms,change] [world].
   freq: machine=2, learning=2, great=1, algorithms=1, change=1, world=1.
   deg:  machine=2+4=6, learning=6, great=1, algorithms=4, change=4, world=1.
   score(w)=deg/freq: machine=3, learning=3, great=1, algorithms=4, change=4, world=1.
   Фрази: "machine learning algorithms change"=14; "machine learning"=6; "great"=1; "world"=1. */
{
  const r = C.keyphrases('Machine learning is great. Machine learning algorithms change the world.', 10);
  ok('rake: топ-1 фраза', r[0].phrase === 'machine learning algorithms change', r[0]);
  ok('rake: топ-1 оцінка', r[0].score === 14, r[0]);
  ok('rake: топ-2 фраза', r[1].phrase === 'machine learning', r[1]);
  ok('rake: топ-2 оцінка', r[1].score === 6, r[1]);
  ok('rake: порядок при рівних оцінках (лексикографічно)', r[2].phrase === 'great' && r[3].phrase === 'world', r.map(x => x.phrase));
  ok('rake: формат запису', typeof r[0].phrase === 'string' && typeof r[0].score === 'number');
}

/* --- Українська: повторюваний термін стає топ-фразою, стоп-слова — межами. */
{
  const t = 'Штучний інтелект змінює світ. Штучний інтелект допомагає людям. ' +
            'Нейронні мережі навчаються на даних. Штучний інтелект — це майбутнє.';
  const r = C.keyphrases(t, 10);
  ok('uk: повторюваний термін у топі', r[0].phrase.indexOf('штучний інтелект') >= 0, r[0]);
  ok('uk: стоп-слово "це" розірвало фразу', !r.some(x => x.phrase.split(' ').includes('це')), r.map(x => x.phrase));
  ok('uk: фрази не містять стоп-слів', !r.some(x => /(^|\s)(і|та|але|це|в|на|з)\s/i.test(' ' + x.phrase + ' ')));
}

/* --- Російська (третій набір STOP). */
{
  const r = C.keyphrases('Машинное обучение меняет мир. Машинное обучение помогает людям.', 5);
  ok('ru: повторюваний термін у топі', r[0].phrase.indexOf('машинное обучение') >= 0, r[0]);
}

/* --- Крайові випадки. */
ok('порожній рядок → []', eq(C.keyphrases('', 5), []));
ok('тільки стоп-слова → []', eq(C.keyphrases('і та але це в на з', 5), []));
ok('одне речення з однією фразою', C.keyphrases('Штучний інтелект.', 5).length === 1);
ok('null → []', eq(C.keyphrases(null, 5), []));
ok('undefined → []', eq(C.keyphrases(undefined, 5), []));
ok('число як текст → []', eq(C.keyphrases(12345, 5), []));

/* --- n: clamp [1..30], дефолт 10. */
{
  const words40 = ['альфа','бета','гамма','дельта','епсилон','дзета','ета','тета','йота','каппа','лямбда','мюон','нюанс','ксилон','омікрон','піфагор','ротор','сигма','таурус','упсілон','фіалка','хімія','псіхея','омега','астра','бриз','вітер','грім','дощ','ефір','жнива','зоря','ірис','клен','ліс','море','небо','озеро','поле','річка'];
  const long = words40.map(w => 'Проєкт ' + w + ' завершено.').join(' ');
  ok('n=100 → максимум 30', C.keyphrases(long, 100).length === 30);
  ok('n=0 → мінімум 1', C.keyphrases(long, 0).length === 1);
  ok('n=NaN → дефолт 10', C.keyphrases(long, NaN).length === 10);
  ok('n=-5 → мінімум 1', C.keyphrases(long, -5).length === 1);
}

/* --- Детермінізм. */
{
  const t = 'Глибоке навчання — це частина машинного навчання. Машинне навчання — частина штучного інтелекту.';
  ok('детерміновано (два виклики)', eq(C.keyphrases(t, 8), C.keyphrases(t, 8)));
  ok('порядок стабільний при рівних оцінках', (() => {
    const r = C.keyphrases(t, 8);
    const sorted = [...r].sort((a, b) => b.score - a.score || b.phrase.split(' ').length - a.phrase.split(' ').length || a.phrase.localeCompare(b.phrase));
    return eq(r, sorted);
  })());
}

/* --- Дедуплікація: та сама фраза зустрічається один раз. */
{
  const r = C.keyphrases('Машинне навчання. Машинне навчання. Машинне навчання.', 10);
  const names = r.map(x => x.phrase);
  ok('фраза не дублюється', names.filter(p => p === 'машинне навчання').length === 1, names);
}

/* --- Захист: tooLarge. */
{
  let threw = false;
  try { C.keyphrases('x'.repeat(500001), 5); } catch (e) { threw = !!(e && e.isCoreError && e.code === 'tooLarge'); }
  ok('>500k → CoreError tooLarge', threw);
}

/* --- Перф: 200k тексту — швидко (лінійний прохід). */
{
  const big = Array(4000).fill('Штучний інтелект та машинне навчання змінюють сучасний світ технологій.').join(' ');
  const t0 = Date.now();
  const r = C.keyphrases(big, 10);
  const dt = Date.now() - t0;
  ok('200k < 3с', dt < 3000, dt + 'мс');
  ok('200k: топ-фраза знайдена', r.length > 0 && typeof r[0].score === 'number');
}

/* --- Регресія: analyze()/keywords()/summarize() не чіпано. */
{
  const t = 'Штучний інтелект змінює світ. Машинне навчання — його частина. Дані — паливо моделей.';
  const a = C.analyze(t);
  ok('analyze: ключі без змін', eq(Object.keys(a).sort(), ['keywords', 'lang', 'partial', 'stats', 'summary', 'truncated']));
  ok('analyze: keywords як раніше', eq(a.keywords.map(k => k.word), C.keywords(t, 10).map(k => k.word)));
  ok('analyze: summary як раніше', eq(a.summary, C.summarize(t, 3)));
  ok('keywords: регресія', eq(C.keywords(t, 5).map(k => k.word + ':' + k.count), ['дані:1', 'змінює:1', 'інтелект:1', 'машинне:1', 'моделей:1']));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
