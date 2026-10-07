import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8");
const tmp=new URL("./worker-v3-under-test.mjs",import.meta.url);
fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());
function ok(c,msg){if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)}
const env={PUBLIC_PLUGIN_MODE:"1",ALLOW_PUBLIC_MCP:"1",BRIDGE_ACCESS_TOKEN:"private-test",GOOGLE_API_KEY:"g",GROQ_API_KEY:"q",OPENROUTER_API_KEY:"r"};

ok(m.MCP_TOOLS.length===4,"Exactly four public Review Panel tools");
for(const n of ["get_review_panel_status","review_task","review_code","review_project_files"])ok(m.MCP_TOOLS.some(t=>t.name===n),"Tool exists: "+n);
ok(m.MCP_TOOLS.every(t=>t.inputSchema?.type==="object"),"All tools have object input schemas");
ok(m.MCP_TOOLS.every(t=>t.outputSchema?.type==="object"),"All public tools declare outputSchema");
ok(m.MCP_TOOLS.every(t=>typeof t.annotations?.readOnlyHint==="boolean"&&typeof t.annotations?.openWorldHint==="boolean"&&typeof t.annotations?.destructiveHint==="boolean"),"All required tool hints explicit");
ok(m.MCP_TOOLS.find(t=>t.name==="get_review_panel_status").annotations.readOnlyHint===true,"Status is read-only");
ok(m.MCP_TOOLS.filter(t=>t.name!=="get_review_panel_status").every(t=>t.annotations.readOnlyHint===false&&t.annotations.openWorldHint===true&&t.annotations.destructiveHint===false),"Review tools disclose external processing and are non-destructive");
const schemaText=JSON.stringify(m.MCP_TOOLS);
ok(!schemaText.includes('"provider"'),"Public tool inputs do not expose provider selection");
ok(!schemaText.includes("ask_single_ai")&&!schemaText.includes("debate_with_ai_team")&&!schemaText.includes("ask_ai_team"),"No generic passthrough/debate tools in public surface");
ok(schemaText.includes("openai/fileParams"),"Project review declares ChatGPT file parameters");
ok(m.panelProviderIds(env).join(",")==="gemini,groqfree,openrouter","Public panel restricted to free review engines");
ok(m.publicPanelReady(env)===true,"Panel ready with three review engines");
ok(m.publicPluginMode(env)===true,"Public plugin mode recognized");
ok(m.toolsForEnv(env).every(t=>!t.securitySchemes),"Public discovery metadata stays scan-friendly");
const privateTools=m.toolsForEnv({...env,PUBLIC_PLUGIN_MODE:"0"});
ok(privateTools.every(t=>Array.isArray(t.securitySchemes)),"Private mode retains OAuth security schemes");

// Public initialize and tools/list work without Authorization.
let req=new Request("https://review.example/mcp",{method:"POST",headers:{"Content-Type":"application/json","MCP-Protocol-Version":"2026-07-28","Mcp-Method":"server/discover"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"server/discover",params:{_meta:{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{name:"test",version:"1"}}}})});
let res=await m.handleMcp(req,env),body=await res.json();
ok(res.status===200&&body.result?.supportedVersions?.includes("2026-07-28"),"Public server/discover succeeds without OAuth");
req=new Request("https://review.example/mcp",{method:"POST",headers:{"Content-Type":"application/json","MCP-Protocol-Version":"2026-07-28","Mcp-Method":"tools/list"},body:JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/list",params:{_meta:{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{name:"test",version:"1"}}}})});
res=await m.handleMcp(req,env);body=await res.json();
ok(res.status===200&&body.result?.tools?.length===4,"Public tools/list returns four tools");
ok(body.result.tools.every(t=>t.outputSchema),"Scanned tools include output schemas");

// Public discovery is anonymous, but tools/call execution must still authenticate.
req=new Request("https://review.example/mcp",{method:"POST",headers:{"Content-Type":"application/json","MCP-Protocol-Version":"2026-07-28"},body:JSON.stringify({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"get_review_panel_status",arguments:{}}})});
res=await m.handleMcp(req,env);
ok(res.status===401,"Public tools/call requires OAuth even when discovery is public");

const status=await m.callMcpTool(env,"get_review_panel_status",{});
ok(status.structuredContent.ready===true&&status.structuredContent.reviewer_count===3,"Status result matches output schema fields");

fs.unlinkSync(tmp);
console.log("All Bridge Review Panel v3 submission tests passed.");
