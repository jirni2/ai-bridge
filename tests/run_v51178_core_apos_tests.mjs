/* Тести ядра v5.11.78: tokenize() — апостроф усередині слова (UAX #29).
   «ім'я», «м'яч», «п'єса», «don't» більше не розриваються; крайові апострофи зрізаються.
   Запуск: node tests/run_v51178_core_apos_tests.mjs */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __PKG_VERSION = require('../bridge-version.json').version /* v5.11.92: було жорстко прописано шлях на машині автора */;
const C = require('../core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 200) : '')); }
}
const AP = "'"; // U+0027

ok('VERSION='+__PKG_VERSION, C.VERSION === __PKG_VERSION, C.VERSION);

/* 1. Українські слова з апострофом — цілі токени (раніше зникали повністю). */
ok("tokenize ім'я", JSON.stringify(C.tokenize('ім' + AP + 'я')) === JSON.stringify(['ім' + AP + 'я']), C.tokenize('ім' + AP + 'я'));
ok("tokenize м'яч", JSON.stringify(C.tokenize('м' + AP + 'яч')) === JSON.stringify(['м' + AP + 'яч']));
ok("tokenize п'єса", JSON.stringify(C.tokenize('п' + AP + 'єса')) === JSON.stringify(['п' + AP + 'єса']));
ok("tokenize м'ясо", C.tokenize('м' + AP + 'ясо').includes('м' + AP + 'ясо'));

/* 2. Англійські скорочення: заперечення зберігається (раніше don't → don). */
{
  const t = C.tokenize("don't stop");
  ok("tokenize don't ціле", t.includes("don't") && !t.includes('don'), t);
}
/* 3. Друкарський апостроф U+2019 і літерний U+02BC (явні \u-escape — символи візуально однакові). */
{
  const t19 = C.tokenize('ім\u2019я');
  ok('U+2019 тримається', t19.length === 1 && t19[0] === 'ім\u2019я', t19);
  const t2bc = C.tokenize('ім\u02BCя');
  ok('U+02BC тримається', t2bc.length === 1 && t2bc[0] === 'ім\u02BCя', t2bc);
}

/* 4. Крайові апострофи зрізаються, а не тримають сміття. */
ok('крайові апострофи', JSON.stringify(C.tokenize("'цитата' гарна")) === JSON.stringify(['цитата', 'гарна']), C.tokenize("'цитата' гарна"));

/* 5. Стара поведінка збережена: цифри — геть, стоп-слова — геть; дефіс МІЖ ЛІТЕРАМИ
   з v5.11.103 тримає слово (UAX #29 WB6/WB7), решта дефісних випадків — як раніше. */
ok('цифри дропаються', C.tokenize('рік 2026').join('|') === 'рік', C.tokenize('рік 2026'));
ok('дефіс між літерами тримає слово (v5.11.103)', C.tokenize('e-mail').join('|') === 'e-mail', C.tokenize('e-mail'));
ok('дефіс біля цифр — розрив як раніше', C.tokenize('10-20').join('|') === '', C.tokenize('10-20'));
ok('тире — розрив як раніше', C.tokenize('слово — слово').join('|') === 'слово|слово');
ok('стоп-слова як раніше', !C.tokenize('це і є').length, C.tokenize('це і є'));

/* 6. Детермінізм і крайні випадки. */
{
  const a = C.tokenize('Бабуся лагідно кликала її ім' + AP + 'я.'), b = C.tokenize('Бабуся лагідно кликала її ім' + AP + 'я.');
  ok('детермінізм', JSON.stringify(a) === JSON.stringify(b));
  ok('порожній рядок → []', Array.isArray(C.tokenize('')) && C.tokenize('').length === 0);
  ok('тільки апострофи → []', C.tokenize("'''").length === 0, C.tokenize("'''"));
}

/* 7. Інтеграція: answer() знаходить речення за словом з апострофом (A/B-кейс A2). */
{
  const ctx = 'Діти весело ганяли м' + AP + 'яч. Діти ганяли.';
  const r = C.answer('що діти ганяли: м' + AP + 'яч?', ctx, 1);
  ok('answer м\'яч → правильне речення', r.length === 1 && r[0].includes('м' + AP + 'яч'), r);
}
/* 8. Інтеграція: keywords() поверхне слова з апострофом (A/B-кейс K1). */
{
  const kw = C.keywords('ім' + AP + 'я ім' + AP + 'я ім' + AP + 'я м' + AP + 'яч м' + AP + 'яч сад', 3).map(x => x.word);
  ok("keywords: ім'я перше", kw[0] === 'ім' + AP + 'я' && kw.includes('м' + AP + 'яч'), kw);
}
/* 9. Інтеграція: summarize() не ламається на апострофах. */
{
  const s = C.summarize('Марічка любила своє ім' + AP + 'я. Ранок був тихий.', 2);
  ok('summarize повертає речення', s.length === 2, s);
}

console.log(`\nrun_v51178: PASS ${pass}, FAIL ${fail}`);
process.exit(fail ? 1 : 0);
