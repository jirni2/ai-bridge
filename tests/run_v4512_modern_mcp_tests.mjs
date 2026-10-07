import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const workerSrc=fs.readFileSync(path.join(here,"..","_worker.js"),"utf8");
const appSrc=fs.readFileSync(path.join(here,"..","app.js"),"utf8");
const tmp=path.join(here,`worker-v4512-${Date.now()}.mjs`);
fs.writeFileSync(tmp,workerSrc);
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const ok=(c,msg)=>{if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)};

const origin="https://bridge.example";
const env={BRIDGE_ACCESS_TOKEN:"super-secret",GOOGLE_API_KEY:"g",GROQ_API_KEY:"q",OPENROUTER_API_KEY:"r"};
const now=Math.floor(Date.now()/1000);
const token=await m.signedToken(env,{typ:"access",iat:now,exp:now+3600,aud:origin+"/mcp",scope:"bridge:run bridge:status offline_access",jti:"test-access"});

function modernBody(method,params={}){
  return {jsonrpc:"2.0",id:"t1",method,params:{...params,_meta:{...(params._meta||{}),"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}};
}
function reqFor(body,extraHeaders={}){
  return new Request(origin+"/mcp",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","MCP-Protocol-Version":"2026-07-28","Mcp-Method":body.method,...extraHeaders},body:JSON.stringify(body)});
}

{
  const r=await m.handleMcp(reqFor(modernBody("server/discover")),env),j=await r.json();
  ok(r.status===200,"modern server/discover returns 200");
  ok(r.headers.get("MCP-Protocol-Version")==="2026-07-28","modern response echoes 2026-07-28");
  ok(j.result?.resultType==="complete","modern discover carries resultType=complete");
  ok(j.result?.ttlMs===300000&&j.result?.cacheScope==="private","modern discover carries cache hints");
  ok(j.result?.supportedVersions?.includes("2026-07-28")&&j.result?.supportedVersions?.includes("2025-11-25"),"discover advertises modern and legacy revisions");
  ok(j.result?._meta?.["io.modelcontextprotocol/serverInfo"]?.name==="bridge-review-panel","modern response stamps serverInfo metadata");
}

{
  const r=await m.handleMcp(reqFor(modernBody("tools/list")),env),j=await r.json();
  ok(r.status===200,"modern tools/list returns 200");
  ok(j.result?.resultType==="complete","modern tools/list carries resultType");
  ok(j.result?.ttlMs===300000&&j.result?.cacheScope==="private","modern tools/list carries cache hints");
  ok(Array.isArray(j.result?.tools)&&j.result.tools.length===4,"modern tools/list exposes four review tools");
}

{
  const body=modernBody("tools/list");
  const r=await m.handleMcp(new Request(origin+"/mcp",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","MCP-Protocol-Version":"2026-07-28"},body:JSON.stringify(body)}),env),j=await r.json();
  ok(r.status===400&&j.error?.code===-32020,"missing Mcp-Method is rejected with HeaderMismatch");
}

{
  const body=modernBody("tools/call",{name:"get_review_panel_status",arguments:{}});
  const r=await m.handleMcp(reqFor(body,{"Mcp-Name":"wrong_name"}),env),j=await r.json();
  ok(r.status===400&&j.error?.code===-32020,"mismatched Mcp-Name is rejected with HeaderMismatch");
}

{
  const body=modernBody("tools/list");delete body.params._meta["io.modelcontextprotocol/clientCapabilities"];
  const r=await m.handleMcp(reqFor(body),env),j=await r.json();
  ok(r.status===400&&j.error?.code===-32602,"missing modern clientCapabilities is rejected");
}

{
  const body={jsonrpc:"2.0",id:"u1",method:"tools/list",params:{_meta:{"io.modelcontextprotocol/protocolVersion":"2099-01-01","io.modelcontextprotocol/clientCapabilities":{}}}};
  const r=await m.handleMcp(new Request(origin+"/mcp",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","MCP-Protocol-Version":"2099-01-01","Mcp-Method":"tools/list"},body:JSON.stringify(body)}),env),j=await r.json();
  ok(r.status===400&&j.error?.code===-32022,"unknown MCP revision is rejected with UnsupportedProtocolVersion");
  ok(j.error?.data?.supported?.includes("2026-07-28"),"unsupported-version error advertises supported revisions");
}

{
  const body={jsonrpc:"2.0",id:"l1",method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"legacy-test",version:"1"}}};
  const r=await m.handleMcp(new Request(origin+"/mcp",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","MCP-Protocol-Version":"2025-06-18"},body:JSON.stringify(body)}),env),j=await r.json();
  ok(r.status===200&&j.result?.protocolVersion==="2025-06-18","legacy initialize remains compatible");
  ok(r.headers.get("MCP-Protocol-Version")==="2025-06-18","legacy response preserves requested supported revision");
}

{
  const meta=m.oauthMeta(new Request(origin+"/.well-known/oauth-authorization-server"));
  ok(meta.scopes_supported.includes("offline_access"),"OAuth discovery advertises offline_access");
  ok(meta.grant_types_supported.includes("refresh_token"),"OAuth discovery advertises refresh_token grant");
}

{
  const u=new URL(origin+"/oauth/authorize");
  u.searchParams.set("response_type","code");
  u.searchParams.set("client_id","https://chatgpt.com/oauth/client.json");
  u.searchParams.set("redirect_uri","https://chatgpt.com/connector_platform_oauth_redirect");
  u.searchParams.set("code_challenge_method","S256");
  u.searchParams.set("code_challenge","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  u.searchParams.set("scope","bridge:run bridge:status offline_access");
  u.searchParams.set("resource",origin+"/mcp");
  const r=await m.default.fetch(new Request(u),env);
  ok(r.status===200,"OAuth authorize accepts offline_access scope");
}

ok(!appSrc.includes("\x08"),"app.js contains no stray backspace control character");
ok(appSrc.includes('/^Bearer\\b/i'),"Connector fallback uses a real Bearer word-boundary regex");
ok(workerSrc.includes('constantTimeEqual(String(f.get("password")||""),String(env.BRIDGE_ACCESS_TOKEN||""))'),"OAuth password check uses constant-time comparison");

fs.unlinkSync(tmp);
console.log("All AI Bridge v4.5.12 modern MCP/OAuth tests passed.");
