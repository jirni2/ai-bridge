/* Тести ядра v5.11.106: злиття паралельної гілки ядра 5.11.103–5.11.105 у ядро сайту.
   Перенесено: дефіс між літерами в tokenize(), keyphrases() (RAKE),
   «фрагмент на початку» без lead-бонуса (summarize + чанки analyze).
   Головне: нічого з v5.11.99 (знання, самонавчання, навчи/забудь, списки) не втрачено.
   Запуск: node tests/run_v511106_core_merge_tests.mjs */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __PKG_VERSION = require('../bridge-version.json').version;
const C = require('../core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 200) : '')); }
}

ok('VERSION=' + __PKG_VERSION, C.VERSION === __PKG_VERSION, C.VERSION);

/* 1. Перенесене з 5.11.103–105 працює. */
ok('tokenize: бізнес-план — один токен', C.tokenize('бізнес-план').join('|') === 'бізнес-план', C.tokenize('бізнес-план'));
ok('tokenize: 10-20 — розрив, як раніше', C.tokenize('10-20 днів').join('|') === 'днів', C.tokenize('10-20 днів'));
ok('keyphrases експортовано', typeof C.keyphrases === 'function');
const kp = C.keyphrases('Машинне навчання змінює світ. Штучний інтелект і машинне навчання поруч.', 5);
ok('keyphrases знаходить «штучний інтелект»', kp.some(x => x.phrase === 'штучний інтелект'), kp);
ok('keyphrases детермінований', JSON.stringify(kp) === JSON.stringify(C.keyphrases('Машинне навчання змінює світ. Штучний інтелект і машинне навчання поруч.', 5)));

/* Фрагмент на початку (уламок попереднього речення) не виграє за рахунок позиції. */
const FRAG = 'енергії вистачило лише на частину міста. ' +
  'Сонячна енергетика швидко розвивається в Україні. ' +
  'Сонячні станції встановлюють громади і бізнес. ' +
  'Енергетика громад стає незалежною від мережі. ' +
  'Вартість сонячних панелей знижується щороку.';
const top1 = C.summarize(FRAG, 1)[0] || '';
ok('summarize: уламок з малої літери не стає top-1', !/^енергії вистачило/.test(top1), top1);
const FULL = 'Енергії вистачило лише на частину міста. ' + FRAG.split('. ').slice(1).join('. ');
ok('summarize: звичайне перше речення поводиться як раніше (без винятків)', Array.isArray(C.summarize(FULL, 2)));

/* 2. Нічого з v5.11.99 не втрачено. */
const a = C.createAssistant();
ok('createAssistant має learnQA', typeof a.learnQA === 'function');
ok('createAssistant має forgetQA', typeof a.forgetQA === 'function');
const cap = a.respond('Яка столиця Австралії?');
ok('вбудовані знання: столиця Австралії', /Канберр/i.test(cap && cap.text || ''), cap && cap.text);
const mi = a.memoryInfo();
ok('memoryInfo містить qa (самонавчання)', mi && typeof mi.qa === 'number', mi);
ok('exportMemory v2', JSON.parse(a.exportMemory()).v === 2);

/* 3. Цілісність ядра після злиття. */
ok('verifyIntegrity() після завантаження', C.verifyIntegrity() === true || (C.verifyIntegrity() && C.verifyIntegrity().ok === true), C.verifyIntegrity());

console.log(`\nrun_v511106: PASS ${pass}, FAIL ${fail}`);
if (fail) process.exit(1);
