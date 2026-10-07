/* v5.11.27: cost chip per answer + named routing policies + "why this model" line.
   1) policyOfPref: {q,speed} -> economy|speed|balanced|quality.
   2) usageCostSince: sums per-provider cost entries since a mark; null when none.
   3) estimateCost/extractUsage sanity for chip data.
   4) Client: renderRouteWhy, costChip in peer tabs, costUsd in syncPayload,
      policy segmented control in index.html, no leftover routingQuality slider.
   5) i18n: new keys exist in en/uk/ru. */
import fs from "node:fs";
// sink must exist BEFORE the worker module binds its const to it
globalThis.__aiBridgeUsageSink=[];
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),tmp=new URL("./worker-v51127-cost.mjs",import.meta.url);
fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());
const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const i18n=fs.readFileSync(new URL("../i18n.js",import.meta.url),"utf8");
let passed=0;const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)};

/* --- 1. policyOfPref --- */
ok(m.policyOfPref({q:0,speed:false})==="economy","q=0 -> economy");
ok(m.policyOfPref({q:3,speed:false})==="economy","q=3 -> economy");
ok(m.policyOfPref({q:5,speed:false})==="balanced","q=5 -> balanced");
ok(m.policyOfPref({q:8,speed:false})==="quality","q=8 -> quality");
ok(m.policyOfPref({q:10,speed:false})==="quality","q=10 -> quality");
ok(m.policyOfPref({q:8,speed:true})==="speed","speed flag wins over q");
ok(m.policyOfPref(undefined)==="balanced","missing pref -> balanced");
ok(m.policyOfPref({q:2,speed:false})==="economy","client ROUTING_POLICIES.economy maps to economy");
ok(m.policyOfPref({q:5,speed:true})==="speed","client ROUTING_POLICIES.speed maps to speed");

/* --- 2. usageCostSince --- */
const sink=globalThis.__aiBridgeUsageSink;
sink.push({provider:"groqfree",model:"m",in:1,out:1,costUsd:0.0042});
sink.push({provider:"groqfree",model:"m",in:1,out:1,costUsd:0.0008});
sink.push({provider:"gemini",model:"m",in:1,out:1,costUsd:0});
ok(m.usageCostSince(0,"groqfree")===0.005,"sums two groqfree entries (0.005)");
ok(m.usageCostSince(0,"gemini")===0,"zero cost entry sums to 0 (free tier)");
ok(m.usageCostSince(0,"openai")===null,"unknown provider -> null");
ok(m.usageCostSince(1,"groqfree")===0.0008,"mark offset skips earlier entries");
ok(m.usageCostSince(999,"groqfree")===null,"mark past end -> null");

/* --- 3. chip data: estimateCost + extractUsage --- */
ok(m.estimateCost("gemini-3.8-flash",1e6,1e6)===0.5,"gemini-3.8-flash 1M/1M = $0.5");
ok(m.estimateCost("openai/gpt-oss-120b",1e6,1e6)===0,"free model estimates 0");
ok(m.estimateCost("no-such-model",100,100)===null,"unknown model -> null");
const u=m.extractUsage("openai",{usage:{prompt_tokens:120,completion_tokens:34}});
ok(u.in===120&&u.out===34,"extractUsage openai-style tokens");

/* --- 4. client --- */
ok(/function renderRouteWhy\(run\)/.test(app),"renderRouteWhy defined");
ok(/renderRouteWhy\(run\)/.test(app),"renderRouteWhy called from renderAnswer");
ok(/lastForcedBy=forced\?/.test(app),"sendTask tracks manual provider override");
ok(/class="costChip"/.test(app),"costChip rendered in peer tabs");
ok(/costUsd:r\.costUsd/.test(app),"syncPayload carries costUsd");
ok(/policyOfRoutingPref/.test(app),"client policyOfRoutingPref defined");
ok(/ROUTING_POLICIES=/.test(app)&&/economy:\{q:2/.test(app),"ROUTING_POLICIES maps economy->{q:2}");
ok(!/\$\("routingQuality"\)/.test(app),"old routingQuality slider gone from app.js");
ok(/id="routingPolicySeg"/.test(html),"routingPolicySeg exists in index.html");
const pols=[...html.matchAll(/data-policy="(economy|speed|balanced|quality)"/g)].map(x=>x[1]);
ok(["economy","speed","balanced","quality"].every(p=>pols.includes(p)),"all 4 policy buttons present");
ok(/data-i18n-aria="routingPolicyLabel"/.test(html),"radiogroup has accessible label key");
ok(/\.policySeg\{/.test(fs.readFileSync(new URL("../styles.css",import.meta.url),"utf8")),"policySeg CSS present");
ok(/\.costChip\{/.test(fs.readFileSync(new URL("../styles.css",import.meta.url),"utf8")),"costChip CSS present");
ok(/\.routeWhy\{/.test(fs.readFileSync(new URL("../styles.css",import.meta.url),"utf8")),"routeWhy CSS present");

/* --- 5. i18n keys en+uk+ru --- */
const NEW=["routingPolicyLabel","policyEconomy","policyEconomyDesc","policySpeed","policySpeedDesc","policyBalanced","policyBalancedDesc","policyQuality","policyQualityDesc","routeWhyFmt","routeWhyBudget","routeWhySticky","routeWhyManual","routeWhyImage","routeWhyLongCtx","costFree","costChipTitle"];
for(const k of NEW){
  const c=(i18n.match(new RegExp(`\\b${k}:`,"g"))||[]).length;
  ok(c>=3,`i18n ${k} в en/uk/ru (${c})`);
}
console.log(`PASS ${passed} checks`);
try{fs.rmSync(tmp,{force:true})}catch(e){}
