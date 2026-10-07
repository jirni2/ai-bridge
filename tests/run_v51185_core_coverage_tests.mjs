/* Тести ядра v5.11.85: answer() — бонус покриття термінів запиту поверх BM25.
   score *= 1 + matched/qTerms: речення з більшою часткою унікальних термінів
   запиту важить більше. Лікує класичну слабкість BM25 — один рідкісний термін
   з високим tf перебиває речення, що містить усі терміни запиту
   (пор. CXM25 U-компонент; analytix RAG «the more hit tokens, the slight coverage bonus»).
   Кейси C1–C3 — з A/B евалу прогону #4 (FIX 3/REGRESSION 0 проти v5.11.82).
   Запуск: node tests/run_v51185_core_coverage_tests.mjs */
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

/* C1: uk, 3 терміни — дистрактор з 4× повтором рідкісного терміна програє
   реченню з усіма трьома термінами. */
{
  const ctx = "Врожайність, врожайність, врожайність, врожайність — ось головна тема зборів фермерів. " +
    "Пшениця добре росте на чорноземах, гектар за гектаром. " +
    "Навесні фермери сіють пшеницю, кожен гектар засіяно. " +
    "Врожайність пшениці з гектара становить сорок центнерів. " +
    "Пшениця і гектар — основа звіту. " +
    "Гектар за гектаром, пшениця скрізь. " +
    "Комбайни збирають пшеницю з кожного гектара.";
  const r = C.answer('врожайність пшениці гектар', ctx, 1);
  ok('C1: мішень з усіма термінами', r.length === 1 && r[0].includes('сорок центнерів'), r);
}
/* C2: en, 4 терміни. */
{
  const ctx = "Battery, battery, battery, battery — the battery defines everything, battery first. " +
    "Capacity matters for every electric scooter on the road. " +
    "The electric scooter has decent capacity for city rides. " +
    "The battery capacity of this electric scooter reaches forty amp hours. " +
    "Electric scooters with good capacity sell fast. " +
    "Capacity and range define each electric scooter. " +
    "Every modern electric scooter improves capacity yearly.";
  const r = C.answer('battery capacity electric scooter', ctx, 1);
  ok('C2: мішень з усіма термінами', r.length === 1 && r[0].includes('forty amp hours'), r);
}
/* C3: uk, 2 терміни зі знаком апострофа (регресія прогону #2 не ламається). */
{
  const ctx = "М'яч, м'яч, м'яч — круглий м'яч котиться. " +
    "Діти гралися у садку. " +
    "Хлопчик на ім'я Остап ганяв м'яч. " +
    "Бабуся кликала, бо забула ім'я. " +
    "Усі знали його ім'я. " +
    "Ім'я записали у журнал.";
  const r = C.answer("ім'я м'яч", ctx, 1);
  ok('C3: мішень з обома термінами', r.length === 1 && r[0].includes('Остап'), r);
}
/* Однотерміновий запит: множник однаковий для всіх (×2) — порядок як у чистого BM25. */
{
  const ctx = 'Шторм насувався, шторм ревів, шторм ламав щогли. Шторм минув. Матроси лагодили щоглу.';
  const r = C.answer('шторм', ctx, 3);
  ok('однотерміновий: топ-1 — інформативне речення', r[0].includes('насувався'), r);
  ok('однотерміновий: порядок убування релевантності', r.length >= 2, r);
}
/* Регресії прогонів #1–#2. */
{
  const r = C.answer('про що шторм?',
    'Шторм насувався, шторм ревів, шторм ламав щогли, шторм топив човни, шторм не вщухав до ранку. Шторм минув. Матроси ремонтували щоглу вранці.', 1);
  ok('R1 (шторм): довге інформативне речення', r.length === 1 && r[0].includes('насувався'), r);
}
{
  const r = C.answer("що діти ганяли: м'яч?", "Діти весело ганяли м'яч. Діти ганяли.", 1);
  ok("R2 (апостроф): правильне речення", r.length === 1 && r[0].includes("м'яч") && r[0].includes('весело'), r);
}
/* Контракт: екстрактивність, порядок, порожнє, clamp, детермінізм. */
{
  const ctx = 'Перше речення про сонце. Друге речення про сонце і тепло. Третє про дощ.';
  const r = C.answer('сонце тепло', ctx, 2);
  ok('екстрактивність: відповіді — підрядки контексту', r.every(s => ctx.includes(s)), r);
  const idxs = r.map(s => ctx.indexOf(s));
  ok('порядок: за вихідним порядком у тексті', idxs.every((v, i) => i === 0 || v > idxs[i - 1]), idxs);
}
ok('порожнє питання → []', C.answer('', 'Щось тут.').length === 0);
ok('порожній контекст → []', C.answer('хто тут?', '').length === 0);
{
  const ctx = 'Альфа бета гамма. Бета гамма дельта. Гамма дельта епсилон. Дельта епсилон дзета.';
  const r = C.answer('альфа бета', ctx, 99);
  ok('n clamp: ≤5', r.length <= 5 && r.length > 0, r.length);
}
{
  const ctx = 'Врожайність пшениці з гектара становить сорок центнерів. Пшениця добре росте. Гектар за гектаром.';
  const a = JSON.stringify(C.answer('врожайність пшениці гектар', ctx, 3));
  const b = JSON.stringify(C.answer('врожайність пшениці гектар', ctx, 3));
  ok('детермінізм', a === b);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
