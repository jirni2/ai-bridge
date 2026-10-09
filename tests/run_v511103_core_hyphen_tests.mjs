/* Тести ядра v5.11.103: tokenize() — дефіс між літерами лишається всередині токена.
   Тейлоринг UAX #29 (U+002D/U+2010/U+2011 як MidLetter — стандарт дозволяє таке для
   індексації; дефолтний UAX #29, як і Intl.Segmenter, дефіс розриває — див. тест 8).
   «бізнес-план», «будь-який», «well-known» — один токен; дефіс біля цифр/пробілів,
   крайовий дефіс і тире — розрив як раніше. keyphrases() — ті самі правила.
   Запуск: node tests/run_v511103_core_hyphen_tests.mjs */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __PKG_VERSION = require('../bridge-version.json').version;
const C = require('../core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 250) : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

ok('VERSION=' + __PKG_VERSION, C.VERSION === __PKG_VERSION, C.VERSION);
ok('verifyIntegrity', C.verifyIntegrity().ok === true);

/* 1. Дефіс між літерами тримає слово (uk). */
ok('бізнес-план цілий', eq(C.tokenize('бізнес-план'), ['бізнес-план']), C.tokenize('бізнес-план'));
ok('будь-який цілий', C.tokenize('будь-який проект').includes('будь-який'), C.tokenize('будь-який проект'));
ok('віце-президент цілий', C.tokenize('віце-президент приїхав').includes('віце-президент'));

/* 2. Дефіс між літерами тримає слово (en), включно з подвійним. */
ok('well-known цілий', eq(C.tokenize('well-known fact'), ['well-known', 'fact']), C.tokenize('well-known fact'));
ok('state-of-the-art цілий', C.tokenize('state-of-the-art model').includes('state-of-the-art'));
ok('e-mail цілий', eq(C.tokenize('e-mail'), ['e-mail']));

/* 3. U+2010 HYPHEN і U+2011 NON-BREAKING HYPHEN канонізуються до U+002D. */
ok('U+2010 → -', eq(C.tokenize('бізнес‐план'), ['бізнес-план']), C.tokenize('бізнес‐план'));
ok('U+2011 → -', eq(C.tokenize('бізнес‑план'), ['бізнес-план']), C.tokenize('бізнес‑план'));

/* 4. Не-дефісні розриви збережено. */
ok('10-20 → [] (цифри дропаються)', C.tokenize('10-20').length === 0, C.tokenize('10-20'));
ok('COVID-19 → covid', eq(C.tokenize('COVID-19'), ['covid']), C.tokenize('COVID-19'));
ok('em-dash розриває', eq(C.tokenize('слово — слово'), ['слово', 'слово']));
ok('en-dash розриває', eq(C.tokenize('слово–слово'), ['слово', 'слово']));
ok('дефіс на початку зрізається', eq(C.tokenize('-початок'), ['початок']));
ok('дефіс в кінці зрізається', eq(C.tokenize('кінець-'), ['кінець']));
ok('подвійний дефіс — розрив', C.tokenize('а--б').length === 0, C.tokenize('а--б'));
ok('дефіс з пробілами — розрив', eq(C.tokenize('слово - слово'), ['слово', 'слово']));

/* 5. Апостроф (v5.11.78) не зачеплено. */
{
  const AP = "'";
  ok("ім'я ціле", eq(C.tokenize('ім' + AP + 'я'), ['ім' + AP + 'я']));
  ok("don't ціле", C.tokenize("don't stop").includes("don't"));
  ok('крайові апострофи зрізаються', eq(C.tokenize("'цитата' гарна"), ['цитата', 'гарна']));
  ok("апостроф+дефіс: ім'я-розум", C.tokenize('ім' + AP + 'я-розум').includes('ім' + AP + 'я-розум'), C.tokenize('ім' + AP + 'я-розум'));
}

/* 6. Фільтри як раніше: стоп-слова, довжина, цифри. */
ok('стоп-слова', C.tokenize('це і є').length === 0);
ok('короткі слова', C.tokenize('я і в').length === 0, C.tokenize('я і в'));
ok('змішане: цифри+дефіс', eq(C.tokenize('рік 2026, план 10-20'), ['рік', 'план']), C.tokenize('рік 2026, план 10-20'));

/* 7. Детермінізм і крайні випадки. */
{
  const a = C.tokenize('Бізнес-план: будь-який well-known приклад.');
  const b = C.tokenize('Бізнес-план: будь-який well-known приклад.');
  ok('детермінізм', eq(a, b), a);
  ok('порожній рядок → []', C.tokenize('').length === 0);
  ok('тільки дефіси → []', C.tokenize('---').length === 0, C.tokenize('---'));
  ok('null → []', C.tokenize(null).length === 0);
}

/* 8. Чесність щодо стандарту: дефолтний UAX #29 (Intl.Segmenter) дефіс РОЗРИВАЄ —
   наше злиття — свідомий тейлоринг для індексації, не дефолт. Цей тест ловить зміну
   поведінки Segmenter, щоб коментар у коді не став брехнею. */
{
  const seg = new Intl.Segmenter('uk', { granularity: 'word' });
  const parts = [...seg.segment('бізнес-план')].filter(x => x.isWordLike).map(x => x.segment);
  ok('Segmenter розриває бізнес-план (тейлоринг, не дефолт)', eq(parts, ['бізнес', 'план']), parts);
  const ap = [...seg.segment("ім'я")].filter(x => x.isWordLike).map(x => x.segment);
  ok("Segmenter тримає ім'я (v5.11.78 — дефолт)", ap.length === 1, ap);
}

/* 9. Інтеграція: keywords() бачить композит одним ключовим словом. */
{
  const kw = C.keywords('бізнес-план бізнес-план бізнес-план магазин магазин сад', 5).map(x => x.word);
  ok('keywords: бізнес-план перший і цілий', kw[0] === 'бізнес-план', kw);
  const kwEn = C.keywords('well-known well-known fact', 3).map(x => x.word);
  ok('keywords en: well-known цілий', kwEn.includes('well-known'), kwEn);
}

/* 10. Інтеграція: keyphrases() (RAKE) — композит лишається цілим словом у фразі. */
{
  const ph = C.keyphrases('Бізнес-план кав’ярні описує витрати. Маркетинговий бізнес-план вже готовий.', 5).map(x => x.phrase);
  ok('keyphrases: є фраза з цілим «бізнес-план»', ph.some(p => p.split(' ').includes('бізнес-план')), ph);
}

/* 11. Інтеграція: answer() (шлях tokenizeQA) не зачеплено — дефісний запит працює. */
{
  const ctx = 'Наш бізнес-план готовий. Фінансовий звіт буде завтра.';
  const r = C.answer('що готово: бізнес-план?', ctx, 1);
  ok('answer знаходить речення з дефісом', r.length === 1 && r[0].includes('бізнес-план'), r);
}

/* 12. A/B проти старої поведінки: раніше було ['бізнес','план'] — тепер один токен.
   Зміна свідома (композити — точніші ключові слова, узгоджено з tokenizeQA). */
{
  const now = C.tokenize('бізнес-план');
  ok('A/B: один токен замість двох', now.length === 1 && now[0] === 'бізнес-план', now);
}

/* 13. Перф: лінійний, без регресу (бюджет як у RAKE-тесті: 200k < 3с). */
{
  const big = 'бізнес-план будь-який well-known '.repeat(7000); /* ~210k символів */
  const t0 = Date.now();
  const toks = C.tokenize(big);
  const dt = Date.now() - t0;
  ok('перф 210k < 3с', dt < 3000, dt + 'мс, токенів ' + toks.length);
  ok('композити цілі у великому тексті', toks.includes('бізнес-план') && toks.includes('well-known'));
}

console.log(`\nrun_v511103: PASS ${pass}, FAIL ${fail}`);
process.exit(fail ? 1 : 0);
