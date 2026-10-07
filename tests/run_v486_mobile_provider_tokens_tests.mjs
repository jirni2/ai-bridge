import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const src=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const tmp=path.join(here,`worker-v486-${Date.now()}.mjs`);
fs.writeFileSync(tmp,src);
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const ok=(c,msg)=>{if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const auth="bridge-secret-token-123456";
const env={BRIDGE_ACCESS_TOKEN:auth,ASSETS:{fetch:async()=>new Response("asset")}};
const headers=(extra={})=>({Authorization:`Bearer ${auth}`,...extra});
const cookieFrom=res=>{
  const raw=res.headers.get("set-cookie")||"";
  return raw.split(";")[0];
};
try{
  // Save mobile Gemini token.
  let res=await m.default.fetch(new Request("https://bridge.example/api/provider-tokens",{
    method:"POST",headers:headers({Origin:"https://bridge.example","Content-Type":"application/json"}),
    body:JSON.stringify({provider:"gemini",token:"mobile-gemini-secret-123456789"})
  }),env);
  let body=await res.json();
  ok(res.status===200&&body.active==="phone","mobile provider token can be saved");
  const cookie=cookieFrom(res);
  ok(cookie.startsWith("ai_bridge_provider_vault="),"provider vault is stored in an HttpOnly cookie");
  ok(!(res.headers.get("set-cookie")||"").includes("mobile-gemini-secret"),"plaintext provider token is not exposed in Set-Cookie");
  ok((res.headers.get("set-cookie")||"").includes("HttpOnly")&&(res.headers.get("set-cookie")||"").includes("Secure"),"provider vault cookie is HttpOnly + Secure");

  // Status must show source but never token.
  res=await m.default.fetch(new Request("https://bridge.example/api/provider-tokens",{headers:headers({Cookie:cookie})}),env);
  const statusText=await res.text();body=JSON.parse(statusText);
  ok(res.status===200&&body.providers.gemini.mobile===true&&body.providers.gemini.active==="phone","mobile token source is reported without revealing token");
  ok(!statusText.includes("mobile-gemini-secret"),"provider token status never returns plaintext secret");

  // Runtime provider status sees the mobile token.
  res=await m.default.fetch(new Request("https://bridge.example/api/status",{headers:headers({Cookie:cookie})}),env);
  body=await res.json();
  ok(res.status===200&&body.providers.gemini===true,"mobile token activates provider for browser API calls");

  // Diagnostics must actually use the mobile token.
  const originalFetch=globalThis.fetch;let sawMobileKey=false;
  globalThis.fetch=async (url,opts={})=>{
    const u=String(url);if(u.includes("generativelanguage.googleapis.com")){sawMobileKey=String(opts.headers?.["x-goog-api-key"]||"")==="mobile-gemini-secret-123456789";return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"OK"}]}}]}),{status:200,headers:{"Content-Type":"application/json"}})}
    throw new Error("unexpected URL "+u);
  };
  try{
    res=await m.default.fetch(new Request("https://bridge.example/api/diagnostics/providers",{method:"POST",headers:headers({Cookie:cookie,"Content-Type":"application/json"}),body:JSON.stringify({providers:["gemini"]})}),env);
    body=await res.json();
    ok(res.status===200&&body.usable===1&&sawMobileKey,"saved mobile token is used by the real provider adapter");
  }finally{globalThis.fetch=originalFetch}

  // Replace the token from the same phone without exposing the old value.
  res=await m.default.fetch(new Request("https://bridge.example/api/provider-tokens",{
    method:"POST",headers:headers({Origin:"https://bridge.example",Cookie:cookie,"Content-Type":"application/json"}),body:JSON.stringify({provider:"gemini",token:"replacement-gemini-secret-987654321"})
  }),env);
  ok(res.status===200,"existing mobile token can be replaced");
  const replacementCookie=cookieFrom(res);
  ok(!String(res.headers.get("set-cookie")||"").includes("replacement-gemini-secret"),"replacement token is never returned in plaintext");

  // Delete mobile override and verify provider disappears without a Cloudflare secret.
  res=await m.default.fetch(new Request("https://bridge.example/api/provider-tokens",{
    method:"DELETE",headers:headers({Origin:"https://bridge.example",Cookie:replacementCookie,"Content-Type":"application/json"}),body:JSON.stringify({provider:"gemini"})
  }),env);
  body=await res.json();
  ok(res.status===200&&body.active==="none","mobile token can be deleted");
  ok((res.headers.get("set-cookie")||"").includes("Max-Age=0"),"last mobile token deletion clears provider vault cookie");

  // Cloudflare secret fallback remains available after deleting phone override.
  const envCloud={...env,GOOGLE_API_KEY:"cloud-secret"};
  res=await m.default.fetch(new Request("https://bridge.example/api/provider-tokens",{
    method:"POST",headers:headers({Origin:"https://bridge.example","Content-Type":"application/json"}),body:JSON.stringify({provider:"gemini",token:"phone-override-abcdef"})
  }),envCloud);
  const cookie2=cookieFrom(res);
  res=await m.default.fetch(new Request("https://bridge.example/api/provider-tokens",{
    method:"DELETE",headers:headers({Origin:"https://bridge.example",Cookie:cookie2,"Content-Type":"application/json"}),body:JSON.stringify({provider:"gemini"})
  }),envCloud);
  body=await res.json();
  ok(body.active==="cloudflare","deleting phone token falls back to existing Cloudflare secret");

  // Cross-origin credential mutation must fail.
  res=await m.default.fetch(new Request("https://bridge.example/api/provider-tokens",{
    method:"POST",headers:headers({Origin:"https://evil.example","Content-Type":"application/json"}),body:JSON.stringify({provider:"gemini",token:"evil-secret-token"})
  }),env);
  ok(res.status===403,"cross-origin provider-token mutation is blocked");

  const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
  ok(!html.includes("data-copy-secret"),"old copy-secret controls are removed from phone setup UI");
  for(const id of ["claude","grok","gemini","groqfree","openrouter","openai"]){
    ok(html.includes(`id="providerToken-${id}"`)&&html.includes(`data-save-provider-token="${id}"`)&&html.includes(`data-delete-provider-token="${id}"`),`${id} has token input + Save + Delete controls`);
  }
} finally {
  fs.unlinkSync(tmp);
}
console.log("AI Bridge v4.8.6 mobile provider token tests passed");
