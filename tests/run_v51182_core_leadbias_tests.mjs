/* Тести ядра v5.11.85: summarize() — lead-bias позиційна вага.
   Заміна грубого posBonus (1.5/1.0/0.6) на криву leadBiasPos:
   лід 2.0, перші 20% 1.5, висновок 1.3, середина 1.0 зі спадом до 0.7
   у довгих текстах (≥8 речень). Очікування перевірено A/B (прогон #3).
   Запуск: node tests/run_v51182_core_leadbias_tests.mjs */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __PKG_VERSION = require('../bridge-version.json').version /* v5.11.92: було жорстко прописано шлях на машині автора */;
const C = require('../core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 200) : '')); }
}
function idx(text, picked) {
  const s = C.splitSentences(text);
  return picked.map(p => s.indexOf(p));
}

ok('VERSION='+__PKG_VERSION, C.VERSION === __PKG_VERSION, C.VERSION);

/* Довгий текст: лід + висновок б'ють щільну середину (спад у довгих текстах). */
const T_LONG = "Зелена енергетика стає основою економіки країни. " +
  "Уряд інвестує в зелену енергетику мільярди гривень. " +
  "Сонячні модулі встановлюють на дахах будинків. " +
  "Вартість батарей падає щороку. " +
  "Виробники фотоелектричних станцій нарощують потужності. " +
  "Панелі працюють навіть у хмарну погоду. " +
  "Власники домашніх станцій економлять на рахунках. " +
  "Обладнання окуповується за п'ять років. " +
  "Нові моделі мають вищий коефіцієнт корисної дії. " +
  "Монтаж системи займає два дні. " +
  "Ринок відновлюваної генерації зростає стрімко. " +
  "Отже, зелена енергетика визначатиме майбутнє країни.";
{
  const r = idx(T_LONG, C.summarize(T_LONG, 2));
  ok('long: лід + висновок [0,11]', JSON.stringify(r) === JSON.stringify([0, 11]), r);
}

/* Лід-зона (перші 20%): важливе друге речення виграє у щільної середини. */
const T_LEADZONE = "Місто запускає програму озеленення вулиць. " +
  "Програма озеленення передбачає десять тисяч нових дерев. " +
  "Саджанці висаджуватимуть волонтери навесні. " +
  "Волонтери вже записалися на весняну толоку. " +
  "Насадження покращать повітря в місті. " +
  "Містяни підтримують висадку саджанців. " +
  "Дерева дадуть тінь спекотного літа. " +
  "Полив насаджень організують комунальники. " +
  "Саджанці з'являться уздовж центрального проспекту. " +
  "Підсумки програми озеленення підіб'ють восени.";
{
  const r = idx(T_LEADZONE, C.summarize(T_LEADZONE, 2));
  ok('lead-zone: [0,1]', JSON.stringify(r) === JSON.stringify([0, 1]), r);
}

/* Висновок 1.3 — не сміття: порожнє останнє речення НЕ витягується. */
const T_THROW = "Вчені знайшли новий вид метелика в Карпатах. " +
  "Новий вид метелика має яскраві крила. " +
  "Метелик живе у високогірних луках. " +
  "Дослідники описали новий вид метелика в журналі. " +
  "Деталі повідомлять згодом.";
{
  const r = idx(T_THROW, C.summarize(T_THROW, 2));
  ok('throwaway-last: [0,1], без індекса 4', JSON.stringify(r) === JSON.stringify([0, 1]), r);
}

/* Короткий текст — стабільність поведінки. */
const T_SHORT = "Дощ іде. Дощ іде сильно. Люди ховаються під дахом.";
{
  const r = idx(T_SHORT, C.summarize(T_SHORT, 2));
  ok('short: [0,1] як раніше', JSON.stringify(r) === JSON.stringify([0, 1]), r);
}

/* Сильний лід (2.0): головне речення при n=1. */
const T_LEAD = "Новий закон про освіту змінює правила вступу. " +
  "Правила вступу обговорювали місяцями. " +
  "Нові правила вступу набудуть чинності восени. " +
  "Університети готуються, бо правила вступу змінюються. " +
  "Студенти чекають, адже правила вступу важливі для всіх.";
{
  const r = idx(T_LEAD, C.summarize(T_LEAD, 1));
  ok('lead: n=1 → [0]', JSON.stringify(r) === JSON.stringify([0]), r);
}

/* Контракт summarize — не зламано. */
{
  const r = C.summarize(T_LONG, 3);
  ok('екстрактивність: речення з оригіналу', r.every(x => T_LONG.includes(x)));
  const s = C.splitSentences(T_LONG);
  ok('порядок оригіналу', s.indexOf(r[0]) < s.indexOf(r[1]) && s.indexOf(r[1]) < s.indexOf(r[2]));
  ok('порожній → []', C.summarize("", 3).length === 0);
  ok('коротший за N → все', C.summarize("Одне речення.", 5).length === 1);
  const big = Array.from({ length: 15 }, (_, i) => "Речення номер " + (i + 1) + " про важливі справи.").join(" ");
  ok('n clamp ≤10', C.summarize(big, 99).length === 10);
  const a = JSON.stringify(C.summarize(T_LONG, 3));
  const b = JSON.stringify(C.summarize(T_LONG, 3));
  ok('детермінізм', a === b);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
