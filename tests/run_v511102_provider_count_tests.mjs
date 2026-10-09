/* v5.11.102: regression — the topbar provider badge must show all 8 providers.
   v5.11.101 narrowed the badge to API-only (X/6), which looked like Muse and
   Core ("Ядро") had disappeared. The badge is a provider-availability count,
   so it covers every entry in PROVIDERS; the honest API-only count stays only
   where the UI literally says "API keys" (topStatus) and in call estimates. */
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(new URL("..",import.meta.url).pathname);
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
let passed=0;
function ok(value,message){if(!value)throw new Error("FAIL: "+message);passed++;console.log("PASS:",message)}
const app=read("app.js"),worker=read("_worker.js");

/* 1. PROVIDERS still lists all 8, including the two built-ins. */
const provBlock=app.slice(app.indexOf("const PROVIDERS={"),app.indexOf("};",app.indexOf("const PROVIDERS={"))+2);
for(const id of ["openai","claude","gemini","grok","groqfree","openrouter","muse","core"])
  ok(new RegExp(`(^|\\s)${id}:\\{`).test(provBlock),`PROVIDERS still contains "${id}"`);
ok(Object.keys(PROVIDERS_COUNT(provBlock)).length===8,"PROVIDERS has exactly 8 entries");
function PROVIDERS_COUNT(block){const m={};for(const mm of block.matchAll(/^\s{2}(\w+):\{/gm))m[mm[1]]=1;return m}

/* 2. The badge counts every available provider over the full PROVIDERS total. */
ok(app.includes("Object.keys(PROVIDERS).filter(id=>status.providers?.[id]).length+\"/\"+Object.keys(PROVIDERS).length"),
  "netCount badge = available/total over ALL providers (denominator 8)");
ok(!app.includes("apiTotal"),"no API-only denominator left in the badge code");

/* 3. The provider list still renders every PROVIDERS entry (nothing hidden). */
ok(/Object\.entries\(PROVIDERS\)/.test(app),"renderProviders iterates all PROVIDERS entries");
ok(!/Object\.entries\(PROVIDERS\)[^;]*filter\(\(\[id\]\)=>!LOCAL_PROVIDER_IDS/.test(app),
  "provider list does not filter out built-in Muse/Core");

/* 4. Honesty preserved: topStatus literally says "API keys", so it stays API-only. */
ok(app.includes("const n=apiProviderIds(j.providers).length"),"top status still counts only real API providers");

/* 5. Server still reports the built-ins as available. */
ok(/providers\.muse=true/.test(worker),"worker status reports providers.muse=true");
ok(/providers\.core=true/.test(worker),"worker status reports providers.core=true");

console.log(`AI Bridge v5.11.102 provider-count tests passed (${passed} assertions).`);
