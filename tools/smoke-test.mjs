#!/usr/bin/env node
/* AI Bridge production smoke test (v5.9.1). Run right after every deploy:
     node tools/smoke-test.mjs https://your-project.pages.dev [--token BRIDGE_ACCESS_TOKEN] [--ai]
   Without --token: public checks only (pages, headers, versions, OAuth
   metadata, MCP challenge, service worker, static assets).
   With --token: also logs in, checks authorized status, learning, Improvement
   Lab and the Cloudflare image engine report.
   With --ai: additionally makes ONE short real provider test per free provider
   (/api/diagnostics/providers) and one real Chat run — this uses AI quota.
   The token is only sent to the URL you pass and is never printed. */
const base=String(process.argv[2]||"").replace(/\/+$/,"");
if(!/^https:\/\//.test(base)&&!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(base)){console.error("Usage: node tools/smoke-test.mjs https://your-project.pages.dev [--token T] [--ai]");process.exit(2)}
const args=process.argv.slice(3),ti=args.indexOf("--token"),token=ti>=0?args[ti+1]:"",withAi=args.includes("--ai");
const localVersion=JSON.parse((await import("node:fs")).readFileSync(new URL("../bridge-version.json",import.meta.url),"utf8")).version;
const results=[];let cookie="";
const check=(name,ok,detail="")=>{results.push({name,ok});console.log(`${ok?"PASS":"FAIL"}  ${name}${detail?` — ${detail}`:""}`)};
const req=async(p,init={})=>{const h=new Headers(init.headers||{});if(cookie)h.set("Cookie",cookie);h.set("Origin",base);const t0=Date.now();const r=await fetch(base+p,{...init,headers:h,redirect:"manual"});r.ms=Date.now()-t0;return r};
async function j(r){try{return await r.json()}catch(e){return {}}}
try{
  const home=await req("/");const html=await home.text();
  check("home page",home.status===200&&html.includes("AI Bridge"),`HTTP ${home.status}, ${home.ms}ms`);
  check("security headers",/frame-ancestors 'none'/.test(home.headers.get("content-security-policy")||"")&&home.headers.get("x-frame-options")==="DENY"&&!!home.headers.get("strict-transport-security"),"CSP, X-Frame-Options, HSTS");
  const deployed=home.headers.get("x-ai-bridge-version");
  check("deployed version",deployed===localVersion,`production=${deployed||"?"} local=${localVersion}`);
  for(const a of ["app.js","styles.css","i18n.js","markdown.js","theme-boot.js","zip-safety-core.js","zip-worker.js","manifest.webmanifest"]){const r=await req("/"+a);check(`asset /${a}`,r.status===200,`HTTP ${r.status}`)}
  // v5.9.4: internal files must not be downloadable from production.
  for(const a of ["/tests/worker-v38-under-test.mjs","/tools/smoke-test.mjs","/MANIFEST.sha256.json","/README.txt"]){const r=await req(a);check(`internal ${a} blocked`,r.status===404,`HTTP ${r.status}`)}
  const sw=await req("/sw.js"),swText=await sw.text();
  check("service worker",sw.status===200&&/no-store/.test(sw.headers.get("cache-control")||"")&&swText.includes(`ai-bridge-v${localVersion.replaceAll(".","-")}`),"no-store + cache name matches version");
  const as=await j(await req("/.well-known/oauth-authorization-server"));
  check("OAuth metadata",!!as.authorization_endpoint&&(as.scopes_supported||[]).includes("offline_access"),"authorization + offline_access");
  const pr=await j(await req("/.well-known/oauth-protected-resource"));check("protected resource metadata",String(pr.resource||"").endsWith("/mcp"));
  const mcp=await req("/mcp",{method:"POST",headers:{"Content-Type":"application/json","MCP-Protocol-Version":"2025-11-25"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"smoke",version:"1"}}})});
  check("MCP requires OAuth",mcp.status===401&&/^Bearer/i.test(mcp.headers.get("www-authenticate")||""),`HTTP ${mcp.status}`);
  const anon=await req("/api/status");check("status without session is protected",anon.status===401||anon.status===503,`HTTP ${anon.status}`);
  if(token){
    const login=await req("/api/session/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});
    cookie=(login.headers.get("set-cookie")||"").split(";")[0];
    check("login",login.status===200&&!!cookie&&/HttpOnly/i.test(login.headers.get("set-cookie")||""),`HTTP ${login.status}`);
    const st=await j(await req("/api/status"));const n=Object.values(st.providers||{}).filter(Boolean).length;
    check("authorized status",st.version===localVersion&&n>0,`${n} provider key(s) configured, jobs: ${st.jobRecoveryLabel||"?"}`);
    check("image engine reported honestly",!!st.media?.imageEngine?.label,st.media?.imageEngine?.label||"");
    const lr=await req("/api/learning");check("learning store",lr.status===200,`HTTP ${lr.status}`);
    const ir=await req("/api/improvement-lab");check("improvement lab",ir.status===200,`HTTP ${ir.status}`);
    if(withAi){
      const d=await j(await req("/api/diagnostics/providers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({providers:["groqfree","openrouter","gemini"]})}));
      for(const x of d.tested||[])check(`provider ${x.provider}`,x.ok,x.ok?`${x.model}, ${x.ms}ms`:`${x.errorKind||x.status||""} ${x.message||""}`.slice(0,120));
      const t0=Date.now();const run=await req("/api/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:"Reply with the single word: pong",displayPrompt:"Reply with the single word: pong",mode:"auto",providers:[],synthesize:false,judge:"auto",searchFirst:false,clientRequestId:`smoke-${Date.now()}`})});
      let body=await j(run);
      if(run.status===202&&body.jobId){for(let i=0;i<40&&!(body.status==="done"||body.status==="error");i++){await new Promise(r=>setTimeout(r,2000));body=await j(await req(`/api/job/status?jobId=${encodeURIComponent(body.jobId)}`))}body=body.result||body}
      check("real chat run",!!String(body.final||"").trim(),`${Math.round((Date.now()-t0)/1000)}s via ${(body.selectedProviders||[]).join(",")||"?"}`);
    }
    await req("/api/session/logout",{method:"POST"});
  }else console.log("(skip) authorized checks — pass --token to run them");
}catch(e){check("network",false,String(e?.message||e))}
const failed=results.filter(r=>!r.ok);
console.log(failed.length?`\nSMOKE TEST FAILED: ${failed.length} check(s). Consider rolling back (see tools/rollback.mjs).`:`\nSMOKE TEST PASSED (${results.length} checks).`);
process.exit(failed.length?1:0);
