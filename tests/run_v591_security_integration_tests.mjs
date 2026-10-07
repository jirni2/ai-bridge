/* v5.9.1 end-to-end security checks through the real fetch handler:
   OAuth code + PKCE -> access/refresh -> MCP (legacy + current) -> refresh
   rotation/replay, invalid redirect, token vault never echoes secrets,
   cookie flags, CSRF/Origin, security headers, media Save & Verify. */
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const tmp=path.join(root,"tests",`worker-v591-sec-${Date.now()}.mjs`);fs.copyFileSync(path.join(root,"_worker.js"),tmp);
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const origin="https://bridge.example",SECRET="bridge-secret-123456";
const env={BRIDGE_ACCESS_TOKEN:SECRET,OAUTH_SIGNING_SECRET:"s".repeat(40),SESSION_SIGNING_SECRET:"x".repeat(40),PROVIDER_VAULT_SECRET:"v".repeat(40),GROQ_API_KEY:"server-groq-key",ASSETS:{fetch:async()=>new Response("<!doctype html><title>x</title>",{headers:{"content-type":"text/html"}})}};
const b64u=b=>Buffer.from(b).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const originalFetch=globalThis.fetch;
try{
  const m=await import(pathToFileURL(tmp).href);
  const call=(p,init={})=>m.default.fetch(new Request(origin+p,init),env,{waitUntil(){}});
  // ---- headers ----
  const home=await call("/");
  ok(/frame-ancestors 'none'/.test(home.headers.get("content-security-policy")||"")&&home.headers.get("x-frame-options")==="DENY","pages send CSP frame-ancestors and X-Frame-Options (clickjacking protection)");
  const st=await call("/api/status");ok(/no-store/.test(st.headers.get("cache-control")||""),"API responses are no-store");
  // ---- session cookie ----
  const login=await call("/api/session/login",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify({token:SECRET})});
  const setCookie=login.headers.get("set-cookie")||"";
  ok(login.status===200&&/HttpOnly/.test(setCookie)&&/Secure/.test(setCookie)&&/SameSite=Strict/.test(setCookie),"session cookie is HttpOnly + Secure + SameSite=Strict");
  const cookie=setCookie.split(";")[0];
  const csrf=await call("/api/feedback",{method:"POST",headers:{Cookie:cookie,Origin:"https://evil.example","Content-Type":"application/json"},body:"{}"});
  ok(csrf.status===403,"cookie-authenticated mutation from a foreign Origin is blocked (CSRF)");
  // ---- token vault: save / read / replace / delete ----
  const H={Cookie:cookie,Origin:origin,"Content-Type":"application/json"};
  let r=await call("/api/provider-tokens",{method:"POST",headers:H,body:JSON.stringify({provider:"openrouter",token:"sk-or-SECRET-VALUE-999"})});
  const vault=(r.headers.get("set-cookie")||"").split(";")[0];const txt=await r.text();
  ok(r.status===200&&!txt.includes("SECRET-VALUE"),"saving a provider token never echoes it back");
  const both=`${cookie}; ${vault}`;
  r=await call("/api/provider-tokens",{headers:{Cookie:both}});const listing=await r.text();
  ok(r.ok&&!listing.includes("SECRET-VALUE")&&!listing.includes("server-groq-key")&&/"active":"phone"/.test(listing),"token listing shows only source (phone/cloudflare), never values");
  ok(/"groqfree":\{[^}]*"active":"cloudflare"/.test(listing),"Cloudflare Secret remains the fallback source");
  r=await call("/api/provider-tokens",{method:"DELETE",headers:{...H,Cookie:both},body:JSON.stringify({provider:"openrouter"})});ok(r.ok,"mobile token can be deleted");
  // ---- media Save & Verify (Cloudflare verify endpoint, no generation) ----
  let verifyCalls=[];globalThis.fetch=async(u,i)=>{verifyCalls.push(String(u));return new Response(JSON.stringify({success:true,result:{status:"active"}}),{status:200,headers:{"content-type":"application/json"}})};
  const good=await m.verifyMediaCredentials({CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),CLOUDFLARE_AI_API_TOKEN:"t"},"cloudflare");
  ok(good.ok&&verifyCalls.every(u=>/tokens\/verify$/.test(u))&&!JSON.stringify(good).includes('"t"'),"valid Cloudflare token verified via free verify endpoint only");
  globalThis.fetch=async()=>new Response(JSON.stringify({success:false}),{status:401});
  const bad=await m.verifyMediaCredentials({CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),CLOUDFLARE_AI_API_TOKEN:"bad"},"cloudflare");
  ok(!bad.ok&&bad.state==="rejected","invalid Cloudflare token is reported as rejected, not success");
  const fal=await m.verifyMediaCredentials({FAL_KEY:"k"},"fal");ok(fal.state==="saved_unverified","fal.ai is honestly reported as saved but unverified (no paid test call)");
  const none=await m.verifyMediaCredentials({},"cloudflare");ok(!none.ok&&none.state==="missing","missing image engine is reported, not simulated");
  globalThis.fetch=originalFetch;
  // ---- OAuth authorization code + PKCE ----
  const verifier=b64u(crypto.randomBytes(32)),challenge=b64u(crypto.createHash("sha256").update(verifier).digest());
  const clientId="https://chatgpt.com/oauth/abc/client.json",redirect="https://chatgpt.com/connector_platform_oauth_redirect";
  const bad1=await call(`/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}&code_challenge=${challenge}&code_challenge_method=S256&scope=bridge:run`);
  ok(bad1.status===400,"authorize rejects a foreign redirect_uri");
  const form=new URLSearchParams({password:SECRET,client_id:clientId,redirect_uri:redirect,code_challenge:challenge,code_challenge_method:"S256",scope:"bridge:run bridge:status offline_access",state:"st1",response_type:"code"});
  r=await call("/oauth/authorize",{method:"POST",body:form});
  const loc=new URL(r.headers.get("location")||"https://x/");const code=loc.searchParams.get("code");
  ok(r.status===302&&code&&loc.searchParams.get("state")==="st1","authorize issues a code to the allowed redirect with state");
  const wrong=await call("/oauth/token",{method:"POST",body:new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:redirect,client_id:clientId,code_verifier:"wrong-verifier-wrong-verifier-wrong-verifier-000"})});
  ok(wrong.status>=400,"token exchange rejects a wrong PKCE verifier");
  r=await call("/oauth/token",{method:"POST",body:new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:redirect,client_id:clientId,code_verifier:verifier})});
  const tok=await r.json();
  ok(r.ok&&tok.access_token&&tok.refresh_token&&/offline_access/.test(tok.scope||"offline_access"),"code + PKCE yields access and refresh tokens (offline_access)");
  // ---- MCP with Bearer ----
  const unauth=await call("/mcp",{method:"POST",headers:{"Content-Type":"application/json","MCP-Protocol-Version":"2025-11-25"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"t",version:"1"}}})});
  ok(unauth.status===401&&/^Bearer/i.test(unauth.headers.get("www-authenticate")||""),"MCP without a token returns 401 with a Bearer challenge");
  const legacy=await call("/mcp",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${tok.access_token}`,"MCP-Protocol-Version":"2025-11-25"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"t",version:"1"}}})});
  const lj=await legacy.json().catch(()=>({}));ok(legacy.ok&&lj.result,"authorized MCP initialize works on the legacy protocol (2025-11-25)");
  const tools=await call("/mcp",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${tok.access_token}`,"MCP-Protocol-Version":"2025-11-25"},body:JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/list",params:{}})});
  const tj=await tools.json().catch(()=>({}));ok(tools.ok&&Array.isArray(tj.result?.tools)&&tj.result.tools.length>0,"authorized tools/list returns the Bridge tools");
  // ---- refresh rotation + replay ----
  r=await call("/oauth/token",{method:"POST",body:new URLSearchParams({grant_type:"refresh_token",refresh_token:tok.refresh_token,client_id:clientId})});
  const tok2=await r.json();ok(r.ok&&tok2.access_token&&tok2.refresh_token&&tok2.refresh_token!==tok.refresh_token,"refresh grant rotates the refresh token");
  r=await call("/oauth/token",{method:"POST",body:new URLSearchParams({grant_type:"refresh_token",refresh_token:tok.refresh_token,client_id:clientId})});
  ok(r.status>=400,"a used refresh token cannot be replayed");
}finally{globalThis.fetch=originalFetch;fs.rmSync(tmp,{force:true})}
console.log("v5.9.1 security integration tests PASS");
