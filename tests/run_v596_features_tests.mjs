/* v5.10.0 server features: cost tracking + budgets (F1), AI Gateway settings
   merge + universal fallback (F2), prompt library + projects (F3), smarter
   routing prefs + sticky routes (F5), fetch-url + web-search endpoints (F6).
   Style follows run_v596_push_tests.mjs. Run: node tests/run_v596_features_tests.mjs */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const ok=(c,msg)=>{if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)};

const m=await import("../_worker.js");
const need=["PRICE_TABLE","estimateCost","mergeUsageDay","extractUsage","renderPromptTemplate",
  "templateVars","forkMessages","extractUrlRefs","orderProvidersByPref","budgetStatus",
  "resolveGatewayConfig","recordUsage","getUsageDay","budgetOver","getSettings","saveSettings",
  "getStickyRoute","setStickyRoute","selectAutoProviders","sanitizeRoutingPref",
  "handleSettings","handleUsage","handlePrompts","handleProjects","handleFetchUrl","handleWebSearch",
  "aiGatewayUniversalUrl","decideRoute","autoSelect","configureAIGateway","aiGatewayUrl","fetchViaGateway"];
for(const n of need)ok(m[n]!==undefined,"exported "+n);

const env0={BRIDGE_ACCESS_TOKEN:"tok"};
const auth={headers:{authorization:"Bearer tok","content-type":"application/json"}};
const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json"}});
const post=(p,body,hdrs=auth.headers)=>new Request("https://x"+p,{method:"POST",headers:hdrs,body:JSON.stringify(body)});
const get=(p,hdrs=auth.headers)=>new Request("https://x"+p,{method:"GET",headers:hdrs});

/* --- F1: PRICE_TABLE + estimateCost --- */
ok(typeof m.PRICE_TABLE==="object"&&m.PRICE_TABLE["gpt-5.6-terra"].in===1.25,"PRICE_TABLE has gpt-5.6-terra pricing");
ok(m.PRICE_TABLE["openai/gpt-oss-120b"].in===0&&m.PRICE_TABLE["openrouter/free"].out===0,"free-tier models are priced at 0");
ok(m.PRICE_TABLE["claude-sonnet-5"]&&m.PRICE_TABLE["gemini-3.8-flash"]&&m.PRICE_TABLE["grok-4.6"],"PRICE_TABLE covers claude/gemini/grok defaults");
ok(m.estimateCost("gpt-5.6-terra",1e6,1e6)===11.25,"estimateCost math: 1M+1M gpt-5.6-terra = $11.25");
ok(m.estimateCost("gemini-3.8-flash",2e6,1e6)===0.6,"estimateCost math: 2M in + 1M out gemini-3.8-flash = $0.60");
ok(m.estimateCost("openai/gpt-oss-120b",5e6,5e6)===0,"estimateCost of a free model is 0");
ok(m.estimateCost("nope-model-xyz",100,100)===null,"estimateCost of an unknown model is null");
ok(m.estimateCost("",0,0)===null,"estimateCost of empty model is null");

/* --- F1: extractUsage shapes --- */
ok(JSON.stringify(m.extractUsage("openai",{usage:{prompt_tokens:10,completion_tokens:5}}))===JSON.stringify({in:10,out:5}),"extractUsage: OpenAI chat shape");
ok(JSON.stringify(m.extractUsage("openai",{usage:{input_tokens:7,output_tokens:3}}))===JSON.stringify({in:7,out:3}),"extractUsage: OpenAI responses shape");
ok(JSON.stringify(m.extractUsage("claude",{usage:{input_tokens:100,output_tokens:50}}))===JSON.stringify({in:100,out:50}),"extractUsage: Anthropic shape");
ok(JSON.stringify(m.extractUsage("gemini",{usageMetadata:{promptTokenCount:20,candidatesTokenCount:8}}))===JSON.stringify({in:20,out:8}),"extractUsage: Gemini shape");
ok(JSON.stringify(m.extractUsage("gemini",{}))===JSON.stringify({in:0,out:0}),"extractUsage: missing usage defaults to 0");

/* --- F1: mergeUsageDay aggregation --- */
{
  const d1=m.mergeUsageDay(null,{provider:"openai",model:"gpt-5.6-terra",inT:100,outT:50,cost:0.000625,date:"2026-09-27"});
  ok(d1.in===100&&d1.out===50&&d1.cost===0.000625,"mergeUsageDay seeds a day aggregate");
  ok(d1.byProvider.openai.in===100&&d1.byProvider.openai.out===50,"mergeUsageDay aggregates per provider");
  ok(d1.byModel["gpt-5.6-terra"].in===100,"mergeUsageDay aggregates per model");
  const d2=m.mergeUsageDay(d1,{provider:"gemini",model:"gemini-3.8-flash",inT:200,outT:0,cost:null,date:"2026-09-27"});
  ok(d2.in===300&&d2.byProvider.gemini.in===200&&d2.cost===0.000625,"mergeUsageDay merges a second entry; null cost keeps token counts");
  ok(Object.keys(d2.byModel).length===2,"mergeUsageDay tracks both models");
}

/* --- F1: recordUsage in-memory (no KV) --- */
{
  const today=new Date().toISOString().slice(0,10);
  await m.recordUsage({},{provider:"openai",model:"gpt-5.6-terra",inT:1000000,outT:1000000});
  const day=m.getUsageDay(today);
  ok(day&&day.in>=1000000&&day.byProvider.openai&&day.byModel["gpt-5.6-terra"],"recordUsage aggregates in-memory without KV");
  ok(typeof day.cost==="number"&&day.cost>=11.25,"recordUsage computes cost via PRICE_TABLE");
  await m.recordUsage({},{provider:"mystery",model:"mystery-model",inT:10,outT:10});
  ok(m.getUsageDay(today).byProvider.mystery.in>=10,"recordUsage records unknown providers (cost null)");
}

/* --- F1: settings store --- */
{
  let res=await m.handleSettings(post("/api/settings",{monthlyBudgetUsd:25,gateway:{enabled:true,accountId:"a".repeat(32),gatewayId:"gw1"},braveKey:"secret-key"}),env0);
  let j=await res.json();
  ok(res.status===200&&j.ok===true,"POST /api/settings stores settings");
  res=await m.handleSettings(get("/api/settings"),env0);
  j=await res.json();
  ok(j.settings.monthlyBudgetUsd===25&&j.settings.gateway.gatewayId==="gw1","GET /api/settings returns public settings");
  ok(j.settings.braveKeySet===true&&!JSON.stringify(j).includes("secret-key"),"braveKey is never returned, only braveKeySet");
  res=await m.handleSettings(post("/api/settings",{monthlyBudgetUsd:-5}),env0);
  ok(res.status===400,"negative budget is rejected");
  res=await m.handleSettings(post("/api/settings",{gateway:{gatewayId:"x".repeat(200)}}),env0);
  ok(res.status===400,"oversize gateway field is rejected");
  res=await m.handleSettings(get("/api/settings",{headers:{}}),env0);
  ok(res.status===401,"settings requires auth");
  const s=await m.getSettings(env0);
  ok(s.braveKey==="secret-key","getSettings exposes the stored secret server-side only");
}

/* --- F1: budget status + enforcement --- */
ok(JSON.stringify(m.budgetStatus(5,10))===JSON.stringify({limit:10,spent:5,over:false}),"budgetStatus: under budget");
ok(m.budgetStatus(15,10).over===true,"budgetStatus: over budget");
ok(m.budgetStatus(999,null).over===false&&m.budgetStatus(999,null).limit===null,"budgetStatus: null limit never over");
{
  await m.saveSettings(env0,{monthlyBudgetUsd:0.0000001,gateway:{enabled:false,accountId:"",gatewayId:""},braveKey:""});
  await m.recordUsage({},{provider:"openai",model:"gpt-5.6-terra",inT:1000000,outT:0});
  ok(await m.budgetOver(env0)===true,"budgetOver is true once monthly spend exceeds the limit");
  await m.saveSettings(env0,{monthlyBudgetUsd:null,gateway:{enabled:false,accountId:"",gatewayId:""},braveKey:""});
  ok(await m.budgetOver(env0)===false,"budgetOver is false with no budget set");
  await m.saveSettings(env0,{monthlyBudgetUsd:25,gateway:{enabled:false,accountId:"",gatewayId:""},braveKey:""});
}

/* --- F1: /api/usage --- */
{
  const res=await m.handleUsage(get("/api/usage"),env0);
  const j=await res.json();
  const today=new Date().toISOString().slice(0,10);
  ok(res.status===200&&j.ok===true&&Array.isArray(j.days),"GET /api/usage returns days");
  ok(j.days.some(d=>d.date===today&&d.in>0),"usage days include today");
  ok(j.totals.in>=j.days.reduce((a,d)=>a+d.in,0)&&typeof j.totals.cost==="number","usage totals aggregate the days");
  ok(j.budget&&j.budget.limit===25&&j.budget.over===false,"usage budget block reports limit and over=false");
}

/* --- F2: gateway settings merge + universal fallback --- */
{
  const ACCT="0123456789abcdef0123456789abcdef";
  let c=await m.resolveGatewayConfig({});
  ok(c.source===""&&!c.base,"resolveGatewayConfig: no config without env or settings");
  c=await m.resolveGatewayConfig({AI_GATEWAY_ID:"gw",AI_GATEWAY_ACCOUNT_ID:ACCT});
  ok(c.source==="env"&&c.base===`https://gateway.ai.cloudflare.com/v1/${ACCT}/gw`,"resolveGatewayConfig: env vars take precedence");
  await m.saveSettings(env0,{monthlyBudgetUsd:null,gateway:{enabled:true,accountId:ACCT,gatewayId:"gwset"},braveKey:""});
  c=await m.resolveGatewayConfig({});
  ok(c.source==="settings"&&c.base===`https://gateway.ai.cloudflare.com/v1/${ACCT}/gwset`,"resolveGatewayConfig: falls back to settings gateway");
  await m.saveSettings(env0,{monthlyBudgetUsd:null,gateway:{enabled:false,accountId:"",gatewayId:""},braveKey:""});
  m.configureAIGateway({AI_GATEWAY_ID:"gw",AI_GATEWAY_ACCOUNT_ID:ACCT});
  const B=`https://gateway.ai.cloudflare.com/v1/${ACCT}/gw`;
  ok(m.aiGatewayUniversalUrl("https://api.groq.com/openai/v1/chat/completions")==="","slug-matched URLs never use the universal endpoint");
  ok(m.aiGatewayUniversalUrl("https://api.duckduckgo.com/?q=x")===`${B}/universal`,"unmatched provider URLs map to ${base}/universal");
  ok(m.aiGatewayUrl("https://api.duckduckgo.com/?q=x")==="","aiGatewayUrl still returns '' for unmatched hosts (legacy behavior)");
  const orig=globalThis.fetch,seen=[];
  globalThis.fetch=async(u,init)=>{seen.push(String(u));if(String(u).startsWith(B))return new Response("nope",{status:404});return J({ok:1})};
  try{
    const r=await m.fetchViaGateway("https://api.duckduckgo.com/?q=x",{method:"GET"});
    const body=await r.json();
    ok(body.ok===1&&seen.length===2&&seen[0]===`${B}/universal`&&!seen[1].startsWith(B),"universal 404 falls back to the direct URL");
  }finally{globalThis.fetch=orig}
  m.configureAIGateway({});
}

/* --- F5: orderProvidersByPref --- */
{
  const eco=m.orderProvidersByPref(["openai","claude","groqfree","gemini"],{q:2});
  ok(JSON.stringify(eco)===JSON.stringify(["groqfree","gemini","openai","claude"]),"economy (q<=3): free first, then cheapest");
  const qual=m.orderProvidersByPref(["groqfree","openrouter","gemini","openai"],{q:9});
  ok(JSON.stringify(qual)===JSON.stringify(["openai","gemini","groqfree","openrouter"]),"quality (q>=7): strongest models first");
  const spd=m.orderProvidersByPref(["openrouter","gemini","groqfree"],{speed:true});
  ok(JSON.stringify(spd)===JSON.stringify(["groqfree","gemini","openrouter"]),"speed: low-latency static order");
  const def=m.orderProvidersByPref(["claude","gemini"],{q:5});
  ok(JSON.stringify(def)===JSON.stringify(["claude","gemini"]),"default pref keeps input order");
  ok(JSON.stringify(m.orderProvidersByPref(["nope","gemini"],{}))===JSON.stringify(["gemini"]),"unknown provider ids are filtered");
  ok(JSON.stringify(m.sanitizeRoutingPref({q:99}))===JSON.stringify({q:10,speed:false}),"routingPref q is clamped to 0..10");
  ok(JSON.stringify(m.sanitizeRoutingPref(null))===JSON.stringify({q:5,speed:false}),"routingPref defaults to q=5");
  ok(m.autoSelect({GROQ_API_KEY:"x",GEMINI_API_KEY:"y"},"hello")[0]==="groqfree","autoSelect default order unchanged (free-first)");
}

/* --- F5: sticky routes --- */
{
  ok(m.setStickyRoute("conv-test-1","gemini","gemini-3.8-flash")===true,"setStickyRoute stores a pin");
  const st=m.getStickyRoute("conv-test-1");
  ok(st&&st.provider==="gemini"&&st.model==="gemini-3.8-flash","getStickyRoute returns the pin");
  ok(m.getStickyRoute("no-such-conv")===null,"getStickyRoute misses cleanly");
  ok(m.setStickyRoute("bad id!!","gemini","x")===false,"invalid convId is rejected");
  const envG={BRIDGE_ACCESS_TOKEN:"tok",GOOGLE_API_KEY:"g"};
  const s1=await m.selectAutoProviders(envG,"some question",{convId:"conv-test-2"});
  ok(s1.ids[0]==="gemini"&&s1.pinned===null,"selectAutoProviders selects and stores the sticky route");
  const s2=await m.selectAutoProviders(envG,"a totally different question",{convId:"conv-test-2"});
  ok(s2.pinned&&s2.pinned.provider==="gemini"&&s2.ids.length===1&&s2.ids[0]==="gemini","selectAutoProviders pins the sticky provider");
  const s3=await m.selectAutoProviders(envG,"q",{convId:"conv-test-2",routingPref:{q:9}});
  ok(s3.ids[0]==="gemini","sticky pin wins over routing preferences");
}

/* --- F5: budget downgrade restricts auto selection to free providers --- */
{
  await m.saveSettings(env0,{monthlyBudgetUsd:0.0000001,gateway:{enabled:false,accountId:"",gatewayId:""},braveKey:""});
  const envAll={BRIDGE_ACCESS_TOKEN:"tok",OPENAI_API_KEY:"o",ANTHROPIC_API_KEY:"c",GOOGLE_API_KEY:"g",GROQ_API_KEY:"q",OPENROUTER_API_KEY:"r",XAI_API_KEY:"x"};
  const sel=await m.selectAutoProviders(envAll,"explain photosynthesis",{convId:"conv-budget-1"});
  ok(sel.budgetDowngraded===true,"budgetDowngraded flag is set when over budget");
  ok(sel.ids.length>0&&sel.ids.every(id=>["gemini","groqfree","openrouter"].includes(id)),"over-budget auto selection is restricted to free providers");
  await m.saveSettings(env0,{monthlyBudgetUsd:null,gateway:{enabled:false,accountId:"",gatewayId:""},braveKey:""});
  const sel2=await m.selectAutoProviders(envAll,"explain photosynthesis",{convId:"conv-budget-2"});
  ok(sel2.budgetDowngraded===false,"no downgrade without a budget");
}

/* --- decideRoute honors routingPref --- */
{
  const d=m.decideRoute({},{mode:"auto",prompt:"hello there",routingPref:{q:2,speed:true}});
  ok(d.routingPref&&d.routingPref.q===2&&d.routingPref.speed===true,"decideRoute echoes the sanitized routingPref");
  const d2=m.decideRoute({},{mode:"auto",prompt:"hello there"});
  ok(d2.routingPref.q===5,"decideRoute defaults routingPref to q=5");
}

/* --- F3: template helpers --- */
ok(JSON.stringify(m.templateVars("Hello {{name}}, you are {{ role }}! {{name}}"))===JSON.stringify(["name","role"]),"templateVars extracts unique placeholders in order");
ok(JSON.stringify(m.templateVars("no vars here {{123}} {{}}"))===JSON.stringify([]),"templateVars ignores non-identifier placeholders");
ok(m.renderPromptTemplate("Hi {{name}}!","x")!=="","renderPromptTemplate handles non-object vars");
ok(m.renderPromptTemplate("Hi {{name}}!",{name:"Serhii"})==="Hi Serhii!","renderPromptTemplate substitutes vars");
ok(m.renderPromptTemplate("Hi {{name}}!",{})==="Hi !","renderPromptTemplate: missing var becomes empty string");
ok(m.renderPromptTemplate("Привіт, {{name}}!",{name:"Сергій"})==="Привіт, Сергій!","renderPromptTemplate preserves unicode");
{
  const msgs=[{role:"user",content:"a",nested:{x:1}},{role:"assistant",content:"b"},{role:"user",content:"c"}];
  const f=m.forkMessages(msgs,1);
  ok(f.length===2&&f[0].content==="a"&&f[1].content==="b","forkMessages clones messages up to uptoIndex (inclusive)");
  f[0].nested.x=999;
  ok(msgs[0].nested.x===1,"forkMessages deep-clones (original untouched)");
  ok(m.forkMessages(msgs,0).length===1&&m.forkMessages(msgs,99).length===3,"forkMessages clamps the index");
}
ok(JSON.stringify(m.extractUrlRefs("see https://example.com/a and http://x.io/b."))===JSON.stringify(["https://example.com/a","http://x.io/b"]),"extractUrlRefs finds multiple urls");
ok(JSON.stringify(m.extractUrlRefs("no links here"))===JSON.stringify([]),"extractUrlRefs returns [] without urls");
ok(JSON.stringify(m.extractUrlRefs("visit https://example.com/a, ok? (https://example.com/a)"))===JSON.stringify(["https://example.com/a"]),"extractUrlRefs strips trailing punctuation and dedupes");

/* --- F3: /api/prompts --- */
{
  let res=await m.handlePrompts(post("/api/prompts",{name:"Translator",body:"Translate {{text}} to {{lang}}."}),env0);
  let j=await res.json();
  ok(res.status===200&&j.ok&&j.item.id&&JSON.stringify(j.item.vars)===JSON.stringify(["text","lang"]),"POST /api/prompts stores item with server-extracted vars");
  const id=j.item.id;
  res=await m.handlePrompts(get("/api/prompts"),env0);
  j=await res.json();
  ok(j.items.some(x=>x.id===id),"GET /api/prompts lists the item");
  res=await m.handlePrompts(post("/api/prompts",{name:"x".repeat(121),body:"b"}),env0);
  ok(res.status===400,"prompt name over 120 chars is rejected");
  res=await m.handlePrompts(post("/api/prompts",{name:"n",body:"just some plain text"}),env0);
  ok(res.status===200,"plain body text is accepted");
  res=await m.handlePrompts(post("/api/prompts",{name:"bad",body:"api_key = hunter2-secret-value"}),env0);
  ok(res.status===400,"credential-looking body is rejected");
  const del=new Request("https://x/api/prompts?id="+encodeURIComponent(id),{method:"DELETE",headers:auth.headers});
  res=await m.handlePrompts(del,env0);j=await res.json();
  ok(j.ok&&j.deleted===true,"DELETE /api/prompts removes the item");
  res=await m.handlePrompts(get("/api/prompts"),env0);j=await res.json();
  ok(!j.items.some(x=>x.id===id),"deleted prompt is gone");
}

/* --- F3: /api/projects --- */
{
  let res=await m.handleProjects(post("/api/projects",{name:"Site audit",instructions:"Review {{target}}.",mode:"code",model:"gpt-5.6-terra"}),env0);
  let j=await res.json();
  ok(res.status===200&&j.ok&&j.item.mode==="code"&&j.item.model==="gpt-5.6-terra","POST /api/projects stores a project");
  const id=j.item.id;
  res=await m.handleProjects(post("/api/projects",{name:"Bad mode",instructions:"x",mode:"nope"}),env0);
  j=await res.json();
  ok(j.item.mode==="auto","unknown project mode defaults to auto");
  const badId=j.item.id;
  res=await m.handleProjects(get("/api/projects"),env0);j=await res.json();
  ok(j.items.some(x=>x.id===id),"GET /api/projects lists projects");
  const del=new Request("https://x/api/projects",{method:"DELETE",headers:auth.headers,body:JSON.stringify({id})});
  res=await m.handleProjects(del,env0);j=await res.json();
  ok(j.ok&&j.deleted===true,"DELETE /api/projects removes the project");
  await m.handleProjects(new Request("https://x/api/projects",{method:"DELETE",headers:auth.headers,body:JSON.stringify({id:badId})}),env0);
}

/* --- F6: /api/fetch-url --- */
{
  const orig=globalThis.fetch;
  const html="<html><head><title>Test Page</title></head><body><nav>menu</nav><script>var x=1;</script><h1>Hello</h1><p>World</p></body></html>";
  globalThis.fetch=async()=>new Response(html,{status:200,headers:{"content-type":"text/html"}});
  try{
    const res=await m.handleFetchUrl(post("/api/fetch-url",{url:"https://example.com/page"}),env0);
    const j=await res.json();
    ok(res.status===200&&j.ok===true,"POST /api/fetch-url returns ok");
    ok(j.title==="Test Page","fetch-url extracts the title");
    ok(j.text.includes("Hello")&&j.text.includes("World"),"fetch-url extracts readable text");
    ok(!j.text.includes("var x=1")&&!j.text.includes("menu"),"fetch-url strips scripts and nav");
    ok(j.url==="https://example.com/page","fetch-url returns the final url");
  }finally{globalThis.fetch=orig}
  let res=await m.handleFetchUrl(post("/api/fetch-url",{url:"http://example.com/x"}),env0);
  ok(res.status===400,"non-https url is rejected");
  res=await m.handleFetchUrl(post("/api/fetch-url",{url:"https://localhost/x"}),env0);
  ok(res.status===400,"localhost url is rejected");
}

/* --- F6: /api/web-search --- */
{
  let res=await m.handleWebSearch(post("/api/web-search",{q:"test query"}),env0);
  let j=await res.json();
  ok(res.status===400&&j.error==="no_key"&&j.hint,"web-search without a key returns no_key with a hint");
  const orig=globalThis.fetch;
  globalThis.fetch=async(u)=>{const s=String(u);if(s.includes("api.search.brave.com"))return J({web:{results:[
    {title:"R1",url:"https://example.com/r1",description:"desc one"},
    {title:"R2",url:"https://example.com/r2",description:"desc two"}]}});return new Response("no",{status:404})};
  try{
    const envK={BRIDGE_ACCESS_TOKEN:"tok",BRAVE_SEARCH_API_KEY:"k123"};
    res=await m.handleWebSearch(post("/api/web-search",{q:"hello"}),envK);
    j=await res.json();
    ok(res.status===200&&j.ok&&j.results.length===2,"web-search returns brave results");
    ok(j.results[0].title==="R1"&&j.results[0].url==="https://example.com/r1"&&j.results[0].snippet==="desc one","web-search result shape is {title,url,snippet}");
    await m.saveSettings(env0,{monthlyBudgetUsd:null,gateway:{enabled:false,accountId:"",gatewayId:""},braveKey:"settings-key"});
    res=await m.handleWebSearch(post("/api/web-search",{q:"hello"}),env0);
    j=await res.json();
    ok(res.status===200&&j.ok,"web-search falls back to the settings braveKey");
    await m.saveSettings(env0,{monthlyBudgetUsd:null,gateway:{enabled:false,accountId:"",gatewayId:""},braveKey:""});
  }finally{globalThis.fetch=orig}
}

/* --- static checks: routes, exports, no secrets --- */
{
  const src=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
  for(const r of ["/api/settings","/api/usage","/api/prompts","/api/projects","/api/fetch-url","/api/web-search"])
    ok(src.includes(`url.pathname==="${r}"`),`route registered: ${r}`);
  const exportBlock=src.slice(src.lastIndexOf("export {"));
  for(const n of ["PRICE_TABLE","estimateCost","mergeUsageDay","extractUsage","renderPromptTemplate","templateVars","forkMessages","extractUrlRefs","orderProvidersByPref","budgetStatus","resolveGatewayConfig","recordUsage","getUsageDay"])
    ok(exportBlock.includes(n),`export block contains ${n}`);
  ok(!/sk-[A-Za-z0-9]{20,}/.test(src),"no sk- secrets in _worker.js");
  ok(!/AIza[0-9A-Za-z_-]{20,}/.test(src),"no AIza secrets in _worker.js");
  ok(src.includes("decision.budgetDowngraded"),"budgetDowngraded flows from the routing decision");
  ok(src.includes("budgetDowngraded:true"),"budgetDowngraded flag reaches chat response meta");
  const ver=(src.match(/^const VERSION="([^"]+)"/m)||[])[1];
  const want=JSON.parse(fs.readFileSync(new URL("../bridge-version.json",import.meta.url),"utf8")).version;
  ok(ver===want,"VERSION constant matches bridge-version.json ("+ver+")");
}

console.log("\nAll v5.10.0 feature tests passed.");
