/* Тести ядра v5.11.100: JSON-експорт аналізу несе поточну версію ядра.
   Регресія з аудиту іншого AI (AUDIT_CORE_v5_11_99): модуль 34 мав захардкоджену
   версію "5.11.72" в EXPORT_VERSION замість топ-рівневого VERSION — експортований
   JSON брехав про версію. Виправлено: EXPORT_VERSION посилається на VERSION.
   Запуск: node tests/run_v511100_export_version_tests.mjs */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

{
  const parsed = JSON.parse(C.exportJSON({ ok: true }));
  ok('JSON-експорт має поточну версію ядра', parsed.version === C.VERSION, parsed.version);
  ok('EXPORT_VERSION не захардкоджено (збігається з VERSION)', parsed.version === C.VERSION && !/5\.11\.72/.test(C.exportJSON({})));
  const parsed2 = JSON.parse(C.exportJSON(null));
  ok('експорт null не ламається і теж несе версію', parsed2.version === C.VERSION);
  const back = C.parseAnalysis(C.exportJSON({ a: 1 }));
  ok('parseAnalysis розбирає експорт назад', back && back.version === C.VERSION && back.analysis && back.analysis.a === 1);
  ok('C.VERSION — непорожній рядок версії', typeof C.VERSION === 'string' && /^\d+\.\d+\.\d+$/.test(C.VERSION), C.VERSION);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
