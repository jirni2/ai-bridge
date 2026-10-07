import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const html=read("index.html"),app=read("app.js"),i18n=read("i18n.js"),workerText=read("_worker.js");

ok(html.includes('value="agent"')&&html.includes('data-quick="agent"'),"Agent Plan is exposed in Team mode and quick controls");
ok(app.includes('modeTitleAgent')&&(app.includes('["auto","agent","god"]')||app.includes('["auto","agent"]')),"client accepts Agent Plan without requiring a manually selected provider");
ok(i18n.includes('modeAgent')&&i18n.includes('agentWorking')&&i18n.includes('agentPhase_planning'),"Agent Plan has localized UI copy and visible progress");
ok(workerText.includes('async function runAgent(')&&workerText.includes('mode==="agent"'),"worker implements Agent Plan as a distinct autonomous mode");
ok(workerText.includes('const AGENT_MAX_STEPS=4;'),"Agent Plan is bounded to one through four steps");

const mod=await import(pathToFileURL(path.join(root,"_worker.js")).href+`?t=${Date.now()}`);
const parsed=mod.parseAgentAction('```json\n{"action":"delegate","provider":"groqfree","task":"Inspect requirements"}\n```');
ok(parsed?.action==="delegate"&&parsed.provider==="groqfree","planner JSON parser accepts fenced structured actions");
ok(mod.parseAgentAction("not json")===null,"malformed planner output is rejected instead of treated as an action");

const originalFetch=globalThis.fetch;
try{
  const calls=[];
  globalThis.fetch=async url=>{
    const u=String(url);calls.push(u);
    if(u.includes("generativelanguage.googleapis.com")){
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"action":"finish","answer":"Fallback Agent Plan completed successfully."}'}]}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    if(u.includes("api.groq.com")){
      return new Response(JSON.stringify({choices:[{message:{content:"invalid planner output"}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    throw new Error("unexpected URL "+u);
  };
  const env={GOOGLE_API_KEY:"gemini-test-key",GROQ_API_KEY:"groq-test-key"};
  const out=await mod.runAgent(env,{task:"Solve the task reliably",providerPrompt:"Solve the task reliably",providerIds:["gemini","groqfree"],maxSteps:4});
  ok(out.final==="Fallback Agent Plan completed successfully.","invalid planner JSON falls back to the next configured provider");
  ok(out.meta?.selfDirected===true&&out.meta?.coreTransport==="provider","Agent Plan remains self-directed and provider-routed rather than renamed Auto mode");
  ok(calls.some(x=>x.includes("generativelanguage"))&&calls.some(x=>x.includes("api.groq.com")),"fallback performs one bounded attempt per provider");
} finally {globalThis.fetch=originalFetch}

try{
  const seen=[];let decisions=0;
  globalThis.fetch=async url=>{
    const target=String(url);seen.push(target);
    if(target.includes("api.groq.com")){
      const actions=[
        {action:"fetch_url",url:"https://aibridge.io/en",purpose:"audit AI Bridge"},
        {action:"fetch_url",url:"https://aibridge-aff.pages.dev/",purpose:"audit actual deployment"},
        {action:"finish",answer:"Checked the deployed AI Bridge site; the namesake was rejected."}
      ];
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(actions[decisions++])}}]}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    if(target==="https://aibridge-aff.pages.dev/")return new Response("<html><title>AI Bridge</title><body>AI Bridge live</body></html>",{status:200,headers:{"Content-Type":"text/html"}});
    throw Error("Unexpected fetch "+target);
  };
  const out=await mod.runAgent({GROQ_API_KEY:"test-key"},{task:"Перевір AI Bridge",providerPrompt:"Перевір AI Bridge",providerIds:["groqfree"],maxSteps:3});
  ok(out.final.includes("deployed AI Bridge")&&seen.includes("https://aibridge-aff.pages.dev/")&&!seen.includes("https://aibridge.io/en"),"Agent rejects a namesake site and fetches its actual deployed origin");
  ok(out.meta.agentToolErrors===1&&out.meta.webFetches===1,"rejected namesake is visible as a tool error and does not spend the fetch budget");
} finally {globalThis.fetch=originalFetch}

console.log("AI Bridge v5.3.6 Agent Plan continuity tests passed.");
