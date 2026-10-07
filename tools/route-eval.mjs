#!/usr/bin/env node
/* AI Bridge M1: еталонний набір питань і тест маршрутизації.
   Проганяє tests/fixtures/route-eval.json через classifyTask + decideRoute
   БЕЗ справжніх викликів AI і без мережі: обидві функції синхронні й
   детерміновані, decideRoute для цих категорій не читає env.
   Використання: node tools/route-eval.mjs [--json]
   Має працювати офлайн за < 10 с. */
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL, fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = await import(pathToFileURL(path.join(root, "_worker.js")).href);
const {classifyTask, decideRoute} = worker;

export function loadFixtures(){
  const p = path.join(root, "tests", "fixtures", "route-eval.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/* Проганяє набір через класифікатор і роутер. Повертає підсумок;
   жодних викликів AI, жодної мережі. */
export function runRouteEval(fixtures){
  const started = Date.now();
  const env = {}; // url_task у наборі немає, env не використовується
  const byGroup = {};
  const errors = [];
  let correct = 0;
  for (const item of fixtures.items){
    const opts = {hasFiles: !!item.hasFiles, hasImages: !!item.hasImages};
    const actualCategory = classifyTask(item.prompt, opts);
    const decision = decideRoute(env, {mode: "auto", prompt: item.prompt}, opts);
    const catOk = actualCategory === item.expectedCategory;
    const routeOk = decision.route === item.expectedRoute;
    const ok = catOk && routeOk;
    if (ok) correct++;
    else errors.push({
      id: item.id, group: item.group, prompt: item.prompt,
      expected: `${item.expectedCategory}/${item.expectedRoute}`,
      actual: `${actualCategory}/${decision.route}`,
      categoryOk: catOk, routeOk
    });
    const g = byGroup[item.group] || (byGroup[item.group] = {total: 0, correct: 0});
    g.total++;
    if (ok) g.correct++;
  }
  const total = fixtures.items.length;
  const groups = {};
  for (const [name, g] of Object.entries(byGroup))
    groups[name] = {total: g.total, correct: g.correct, accuracy: g.total ? g.correct / g.total : 0};
  return {
    total, correct,
    accuracy: total ? correct / total : 0,
    groups, errors,
    ms: Date.now() - started
  };
}

export function formatReport(res){
  const lines = ["AI Bridge route-eval (M1) — офлайн, без викликів AI"];
  for (const [name, g] of Object.entries(res.groups))
    lines.push(`  «${name}»: ${g.correct}/${g.total} (${(g.accuracy * 100).toFixed(1)}%)`);
  lines.push(`Загалом: ${res.correct}/${res.total} (${(res.accuracy * 100).toFixed(1)}%)`);
  lines.push(`Час: ${res.ms} мс`);
  if (res.errors.length){
    lines.push(`Помилки (${res.errors.length}):`);
    for (const e of res.errors)
      lines.push(`  - [${e.id}] «${e.prompt}» — очікував ${e.expected}, отримав ${e.actual}`);
  } else {
    lines.push("Помилок немає.");
  }
  return lines.join("\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain){
  const fixtures = loadFixtures();
  const res = runRouteEval(fixtures);
  if (process.argv.includes("--json")) console.log(JSON.stringify(res, null, 1));
  else console.log(formatReport(res));
}
