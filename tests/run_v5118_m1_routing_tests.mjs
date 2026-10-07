/* AI Bridge M1: еталонний набір питань і тест маршрутизації.
   Жодних викликів AI і жодної мережі: набір tests/fixtures/route-eval.json
   проганяється через classifyTask + decideRoute (обидві синхронні й
   детерміновані). Тест ПАДАЄ, якщо точність нижча за базову, записану
   у фікстурі — так видно, чи зміна в роутингу погіршила роботу. */
import {loadFixtures, runRouteEval} from "../tools/route-eval.mjs";

let passed = 0;
function ok(cond, msg){ if(!cond) throw new Error("FAIL: "+msg); passed++; console.log("PASS:", msg); }

const fixtures = loadFixtures();
ok(Array.isArray(fixtures.items) && fixtures.items.length === 60,
  `набір містить рівно 60 питань (є ${fixtures.items?.length})`);

const res = runRouteEval(fixtures);

const groups = Object.keys(res.groups);
ok(groups.length === 6, `6 груп у наборі (${groups.join(", ")})`);
for (const [name, g] of Object.entries(res.groups))
  ok(g.total === 10, `група «${name}» має 10 питань`);

ok(res.ms < 10000, `оцінка працює офлайн за < 10 с (зайняло ${res.ms} мс)`);

const base = fixtures.baseline || {};
ok(res.accuracy >= (base.overall ?? 1),
  `загальна точність не нижча за базову: ${(res.accuracy*100).toFixed(1)}% >= ${((base.overall ?? 1)*100).toFixed(1)}%`);
for (const [name, g] of Object.entries(res.groups)){
  const b = base.perCategory?.[name] ?? 1;
  ok(g.accuracy >= b,
    `група «${name}»: ${(g.accuracy*100).toFixed(1)}% >= базових ${(b*100).toFixed(1)}%`);
}

const knownRoutes = new Set(["search", "direct", "local", "agent", "god"]);
for (const item of fixtures.items)
  ok(knownRoutes.has(item.expectedRoute),
    `маршрут «${item.expectedRoute}» [${item.id}] — відомий`);

if (res.errors.length){
  console.log("Помилки маршрутизації:");
  for (const e of res.errors)
    console.log(`  - [${e.id}] «${e.prompt}» — очікував ${e.expected}, отримав ${e.actual}`);
}
ok(res.errors.length === 0, `жодної помилки класифікації/маршруту (${res.correct}/${res.total})`);

console.log(`M1 route-eval: ${res.correct}/${res.total} (${(res.accuracy*100).toFixed(1)}%), ${res.ms} мс, перевірок: ${passed}`);
