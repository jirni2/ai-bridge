/* v5.9.9: AI Gateway routing, history sync, assistant roles, usage panel, simpler navigation. */
import fs from "node:fs";import path from "node:path";import vm from "node:vm";import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const tmp=path.join(root,"tests",`worker-v599-${Date.now()}.mjs`);fs.copyFileSync(path.join(root,"_worker.js"),tmp);
const orig=globalThis.fetch,J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json"}});
const ACCT="0123456789abcdef0123456789abcdef";
try{
  const m=await import(pathToFileURL(tmp).href);
  // --- AI Gateway ---
  ok(!m.configureAIGateway({})&&m.aiGatewayUrl("https://api.groq.com/openai/v1/chat/completions")==="","gateway is off unless configured");
  ok(!m.configureAIGateway({AI_GATEWAY_ID:"bad id!",CLOUDFLARE_ACCOUNT_ID:ACCT}),"an invalid gateway name keeps the gateway off");
  m.configureAIGateway({AI_GATEWAY_ID:"aibridge",CLOUDFLARE_ACCOUNT_ID:ACCT});
  const B=`https://gateway.ai.cloudflare.com/v1/${ACCT}/aibridge`;
  ok(m.aiGatewayUrl("https://api.groq.com/openai/v1/chat/completions")===`${B}/groq/chat/completions`,"Groq maps to the gateway");
  ok(m.aiGatewayUrl("https://generativelanguage.googleapis.com/v1beta/models/x:generateContent")===`${B}/google-ai-studio/v1beta/models/x:generateContent`,"Gemini maps to google-ai-studio");
  ok(m.aiGatewayUrl("https://openrouter.ai/api/v1/chat/completions")===`${B}/openrouter/chat/completions`&&m.aiGatewayUrl("https://api.anthropic.com/v1/messages")===`${B}/anthropic/v1/messages`&&m.aiGatewayUrl("https://api.openai.com/v1/responses")===`${B}/openai/responses`,"OpenRouter, Anthropic and OpenAI map to the gateway");
  ok(m.aiGatewayUrl("https://api.duckduckgo.com/?q=x")===""&&m.aiGatewayUrl("https://api.groq.com.evil.com/x")==="","non-AI and look-alike hosts are never routed");
  let seen=[];
  globalThis.fetch=async(u,init)=>{seen.push({u:String(u),h:new Headers(init?.headers||{})});return J({choices:[{message:{content:"ok"}}]})};
  await m.fetchJSON("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer k"},body:"{}"},"Groq");
  ok(seen.length===1&&seen[0].u.startsWith(B)&&seen[0].h.get("authorization")==="Bearer k","provider call goes through the gateway with the provider key");
  m.configureAIGateway({AI_GATEWAY_ID:"aibridge",CLOUDFLARE_ACCOUNT_ID:ACCT,AI_GATEWAY_TOKEN:"gwtok"});seen=[];
  await m.fetchJSON("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{},body:"{}"},"Groq");
  ok(seen[0].h.get("cf-aig-authorization")==="Bearer gwtok","authenticated gateway gets cf-aig-authorization");
  seen=[];globalThis.fetch=async(u,init)=>{seen.push(String(u));if(String(u).startsWith(B))return new Response("not found",{status:404});return J({ok:1})};
  const r1=await m.fetchJSON("https://api.groq.com/openai/v1/chat/completions",{method:"POST",body:"{}"},"Groq");
  ok(r1.ok===1&&seen.length===2&&!seen[1].startsWith(B),"a misconfigured gateway (404) falls back to the direct provider URL");
  seen=[];globalThis.fetch=async(u)=>{seen.push(String(u));if(String(u).startsWith(B))throw new TypeError("network down");return J({ok:2})};
  const r2=await m.fetchJSON("https://api.groq.com/openai/v1/chat/completions",{method:"POST",body:"{}"},"Groq");
  ok(r2.ok===2&&m.aiGatewayStatus().directFallbacks>=2,"an unreachable gateway falls back to direct and is counted");
  globalThis.fetch=async(u)=>J({error:{message:"rate"}},429);
  let st=0;try{await m.fetchJSON("https://api.groq.com/openai/v1/chat/completions",{method:"POST",body:"{}"},"Groq")}catch(e){st=e.status}
  ok(st===429,"provider errors through the gateway (429) are not retried direct — normal fallback logic handles them");
  m.configureAIGateway({});
  // --- roles ---
  ok(m.withAssistantRole("TASK",{name:"Перекладач",instructions:"Translate <b>carefully</b>"}).includes("Translate b carefully /b")&&!m.withAssistantRole("TASK",{name:"n",instructions:"Translate <b>x</b>"}).includes("<b>")&&m.withAssistantRole("TASK",{name:"x",instructions:"y"}).endsWith("TASK"),"role instructions wrap the task with markup stripped");
  ok(m.withAssistantRole("TASK",{name:"x",instructions:"use key sk-abcdefghijklmnopqrstuvwxyz123456"})==="TASK"&&m.withAssistantRole("TASK",null)==="TASK","roles with secrets or no role leave the prompt unchanged");
  ok(m.safeAssistantRole({name:"a",instructions:"z".repeat(5000)}).instructions.length===1500,"role instructions are capped");
  // --- history sync ---
  const env0={BRIDGE_ACCESS_TOKEN:"tok"},auth={headers:{authorization:"Bearer tok","content-type":"application/json"}};
  let res=await m.handleHistory(new Request("https://x/api/history",auth),env0);let j=await res.json();
  ok(res.status===200&&j.enabled===false&&j.reason==="kv_not_bound","without KV, sync reports it is not available");
  res=await m.handleHistory(new Request("https://x/api/history",{headers:{}}),env0);ok(res.status===401,"history requires the owner's login");
  const store=new Map(),kv={get:async k=>store.get(k)??null,put:async(k,v)=>{store.set(k,v)},delete:async k=>{store.delete(k)}};
  const env={BRIDGE_ACCESS_TOKEN:"tok",AI_BRIDGE_JOBS:kv};
  const item=(uid,created,extra={})=>({uid,created,prompt:"q"+uid,final:"a",providers:["gemini"],attachments:[{name:"f.zip",data:"AAAA"}],results:[{provider:"gemini",ok:true,ms:5,text:"t",secretBlob:"x"}],...extra});
  res=await m.handleHistory(new Request("https://x/api/history",{...auth,method:"POST",body:JSON.stringify({items:[item("aaaaaaaa1",1),item("bad",2),item("bbbbbbbb2",3)]})}),env);j=await res.json();
  ok(j.items.length===2&&j.items[0].uid==="bbbbbbbb2","POST stores valid items newest first and drops invalid ids");
  ok(j.items[0].attachments[0]==="f.zip"&&!JSON.stringify(j.items).includes("AAAA")&&!JSON.stringify(j.items).includes("secretBlob"),"attachment data and unknown fields are never stored");
  res=await m.handleHistory(new Request("https://x/api/history",{...auth,method:"POST",body:JSON.stringify({items:[item("aaaaaaaa1",1,{final:"new",updated:9})]})}),env);j=await res.json();
  ok(j.items.find(x=>x.uid==="aaaaaaaa1").final==="new"&&j.items.length===2,"a newer copy of the same item replaces the old one");
  const many=Array.from({length:90},(_,i)=>item("cccccccc"+i,100+i));
  res=await m.handleHistory(new Request("https://x/api/history",{...auth,method:"POST",body:JSON.stringify({items:many})}),env);j=await res.json();
  ok(j.items.length<=60&&store.get("history:v1").length<=900000,"history is capped in count and size");
  res=await m.handleHistory(new Request("https://x/api/history",{...auth,method:"DELETE"}),env);j=await res.json();ok(j.items.length===0&&!store.has("history:v1"),"DELETE clears the synced history");
}finally{globalThis.fetch=orig;fs.rmSync(tmp,{force:true})}
// --- client ---
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),html=fs.readFileSync(path.join(root,"index.html"),"utf8"),css=fs.readFileSync(path.join(root,"styles.css"),"utf8"),i18n=fs.readFileSync(path.join(root,"i18n.js"),"utf8");
const us=app.slice(app.indexOf("const USAGE_KEY="),app.indexOf("let usageRange=1;"));
const mem=new Map(),ctx={localStorage:{getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,String(v))},Date,JSON,Object,Math,String,Number,Array};
vm.runInNewContext(us+";globalThis.api={recordUsage,usageSummary,dayKey}",ctx);
const now=Date.now();
ctx.api.recordUsage({created:now,results:[{provider:"gemini",ok:true,ms:2000},{provider:"groqfree",ok:false,errorKind:"rate_limited"},{provider:"openrouter",cancelled:true,status:499}]});
ctx.api.recordUsage({created:now,results:[{provider:"gemini",ok:true,ms:1000}]});
ctx.api.recordUsage({created:now-3*86400000,results:[{provider:"gemini",ok:false,errorKind:"timeout"}]});
const today=ctx.api.usageSummary(1,now),week=ctx.api.usageSummary(7,now);
const g=today.find(r=>r.id==="gemini"),q=today.find(r=>r.id==="groqfree");
ok(g.n===2&&g.ok===2&&g.avgMs===1500&&q.err===1&&q.lastErr==="rate_limited"&&!today.find(r=>r.id==="openrouter"),"usage counts requests, successes, speed and errors (cancelled calls ignored)");
ok(week.find(r=>r.id==="gemini").n===3,"7-day view includes earlier days");
ok(/class="tab[^"]*navExtra" data-page="agent"/.test(html)&&(html.match(/navExtra/g)||[]).length===5&&/class="tab navExtra" data-page="crew"/.test(html)&&/id="moreTab"/.test(html)&&/id="navDrawer"/.test(html)&&!/id="moreSheet"/.test(html),"phone navigation: 5 drawer tabs (Agent, Team, Brain, Connect, Crew) via right drawer (D4)");
/* REBUILD «Тиша»: зі сторінки чату прибрано дубль навігації modeSwitch —
   навігація лишається через нижні вкладки і праву колонку-меню.
   modeSwitch лишився на сторінках Агент і Команда (2 шт). */
ok((html.match(/class="modeSwitch"/g)||[]).length===2&&/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/.test(css),"Agent/Team share one mode switch; bottom bar has 5 columns");
ok(/id="editPromptBtn"/.test(html)&&/id="otherModelBtn"/.test(html)&&/id="compareBox"/.test(html)&&/forceProvider:id/.test(app)&&/mode="single";providers=\[forced\]/.test(app),"answer can be edited or re-asked with another model and compared");
ok((html.match(/data-role-open/g)||[]).length>=2&&/role:\{name:r\.name,instructions:r\.instructions\}/.test(app),"roles are available in Chat and Agent and sent with each request");
ok(/id="usageCard"/.test(html)&&/id="historySyncToggle"/.test(html)&&/localStorage\.getItem\(SYNC_KEY\)==="1"/.test(app),"history page has usage and an opt-in (off by default) sync switch");
for(const k of ["usageTitle","historySyncLabel","otherModel","editPrompt","roleTitle","navMore","close","uErr_rate_limited"])ok((i18n.match(new RegExp("[{,\\s]"+k+":","g"))||[]).length>=3,`i18n ${k} in en/uk/ru`);
console.log("v5.9.9 features tests PASS");
