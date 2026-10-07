/* v5.11.20: effort toggle (thinking depth) + secret-paste guard (client regexes). */
import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),tmp=new URL("./worker-v51120-effort.mjs",import.meta.url);
fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}

// sanitizeEffort
ok(m.sanitizeEffort("fast")==="fast","sanitizeEffort keeps fast");
ok(m.sanitizeEffort("deep")==="deep","sanitizeEffort keeps deep");
ok(m.sanitizeEffort("standard")==="standard","sanitizeEffort keeps standard");
ok(m.sanitizeEffort("bogus")==="standard","sanitizeEffort defaults unknown to standard");
ok(m.sanitizeEffort(undefined)==="standard","sanitizeEffort defaults missing to standard");
ok(m.sanitizeEffort("DEEP")==="deep","sanitizeEffort is case-insensitive");

// reasoningEffortValue mapping
ok(m.reasoningEffortValue("fast")==="low","fast maps to low");
ok(m.reasoningEffortValue("standard")==="medium","standard maps to medium");
ok(m.reasoningEffortValue("deep")==="high","deep maps to high");

// Groq body mapping — replicate the exact branch logic via source inspection
// to guarantee standard behavior is unchanged (no reasoning_effort for plain
// models, low for gpt-oss, none for qwen).
const wsrc=src;
ok(/if\(\/\^qwen\\\//.test(wsrc),"qwen branch still forces reasoning_effort=none");
ok(/gpt-oss-\/\i\.test\(mdl\)\)\{body\.reasoning_effort=eff==="deep"\?"high":"low"/.test(wsrc),"gpt-oss: standard/fast -> low, deep -> high");
ok(/else if\(eff==="fast"\)body\.reasoning_effort="low"/.test(wsrc),"non-qwen fast -> low");
ok(/else if\(eff==="deep"\)body\.reasoning_effort="high"/.test(wsrc),"non-qwen deep -> high");

// OpenAI Responses API uses the effort variable in both image and text bodies.
ok((wsrc.match(/reasoning:\{effort:eff\}/g)||[]).length===2,"callOpenAI sets reasoning.effort=eff in both body shapes");

// OpenRouter only adds reasoning for non-standard effort (prior body unchanged).
ok(/eff==="standard"\?\{\}:\{reasoning:\{effort:eff==="fast"\?"low":"high"\}\}/.test(wsrc),"openrouter adds reasoning only for fast/deep");

// callGrok maps effort into extraBody only for non-standard.
ok(/eff==="standard"\?\{\}:\{reasoning_effort:eff==="fast"\?"low":"high"\}/.test(wsrc),"grok adds reasoning_effort only for fast/deep");

// runTeamCore threads the user effort into the main answer paths.
ok(/const effort=sanitizeEffort\(body\?\.effort\),effortOpts=\{effort\};/.test(wsrc),"runTeamCore reads body.effort into effortOpts");
ok((wsrc.match(/raceProviderBatch\(env,[^)]*effortOpts\)/g)||[]).length>=6,"raceProviderBatch gets effortOpts on all runTeamCore paths");
ok((wsrc.match(/runOne\(env,id,mode,prompt,null,null,null,validationMode,images,effortOpts\)/g)||[]).length>=3,"main runOne paths get effortOpts");

// Client-side: effort payload + guard wiring present in app.js.
const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
ok(/effort:getEffort\(\)/.test(app),"sendTask payload carries effort");
ok(/const EFFORT_KEY="ai_bridge_effort_v1"/.test(app),"effort localStorage key defined");
ok(/wireEffortChips\(\)/.test(app),"effort chips wired");
ok(/guardSecretsBeforeSend\(source,prompt,options\)/.test(app),"sendTask calls the secret guard");
ok(/showSecretGuard\(input,\{retryAgent:true\}\)/.test(app),"agent page calls the secret guard");
ok(/findSecretLike\(pasted\)/.test(app),"paste listener scans pasted text");
ok(/id="effortChips"/.test(fs.readFileSync(new URL("../index.html",import.meta.url),"utf8")),"effort chips HTML present");
ok(/\.secretGuardBar\{/.test(fs.readFileSync(new URL("../styles.css",import.meta.url),"utf8")),"secret guard CSS present");

fs.unlinkSync(tmp);
console.log("All v5.11.20 effort/guard tests passed.");
