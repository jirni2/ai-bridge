import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8");
const tmp=new URL("./worker-v495-under-test.mjs",import.meta.url);fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());
function ok(c,msg){if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)}
const env={BRIDGE_ACCESS_TOKEN:"MASTER-bridge-token-should-never-be-cookie",SESSION_SIGNING_SECRET:"session-secret-495",PROVIDER_VAULT_SECRET:"vault-secret-495",OAUTH_SIGNING_SECRET:"oauth-secret-495"};
const loginReq=new Request("https://bridge.example/api/session/login",{method:"POST",headers:{"Content-Type":"application/json","Origin":"https://bridge.example"},body:JSON.stringify({token:env.BRIDGE_ACCESS_TOKEN})});
const loginRes=await m.default.fetch(loginReq,env,{});ok(loginRes.status===200,"session login succeeds");
const setCookie=loginRes.headers.get("set-cookie")||"";ok(setCookie.includes("ai_bridge_session="),"session cookie issued");ok(!setCookie.includes(env.BRIDGE_ACCESS_TOKEN),"session cookie does not contain BRIDGE_ACCESS_TOKEN");ok(/HttpOnly/i.test(setCookie)&&/Secure/i.test(setCookie)&&/SameSite=Strict/i.test(setCookie),"session cookie security attributes preserved");
const pair=setCookie.split(";")[0],cookieValue=decodeURIComponent(pair.slice(pair.indexOf("=")+1));
let a=await m.authOK(new Request("https://bridge.example/api/status",{headers:{Cookie:`ai_bridge_session=${encodeURIComponent(cookieValue)}`}}),env);ok(a.ok===true,"signed browser session authenticates");
a=await m.authOK(new Request("https://bridge.example/api/status",{headers:{Cookie:`ai_bridge_session=${encodeURIComponent(cookieValue.slice(0,-1)+(cookieValue.endsWith("A")?"B":"A"))}`}}),env);ok(a.ok===false,"tampered browser session is rejected");
a=await m.authOK(new Request("https://bridge.example/api/status",{headers:{Cookie:`ai_bridge_session=${encodeURIComponent(env.BRIDGE_ACCESS_TOKEN)}`}}),env);ok(a.ok===false,"legacy raw master-token session cookie is rejected");
a=await m.authOK(new Request("https://bridge.example/api/status",{headers:{Authorization:`Bearer ${env.BRIDGE_ACCESS_TOKEN}`}}),env);ok(a.ok===true,"Bearer BRIDGE_ACCESS_TOKEN compatibility retained");
const cross=new Request("https://bridge.example/api/session/login",{method:"POST",headers:{"Content-Type":"application/json","Origin":"https://evil.example"},body:JSON.stringify({token:env.BRIDGE_ACCESS_TOKEN})});ok((await m.default.fetch(cross,env,{})).status===403,"cross-origin session login blocked");
ok(m.sessionSigningSecret(env)===env.SESSION_SIGNING_SECRET,"dedicated SESSION_SIGNING_SECRET has priority");ok(m.providerVaultSecrets(env)[0]===env.PROVIDER_VAULT_SECRET,"dedicated PROVIDER_VAULT_SECRET has priority");
const work=fs.readFileSync(new URL("../work.html",import.meta.url),"utf8"),workRoute=fs.readFileSync(new URL("../work/index.html",import.meta.url),"utf8");ok(work===workRoute,"work/index.html is synchronized byte-for-byte with work.html");ok(!workRoute.includes("sessionStorage). Ключі"),"stale sessionStorage copy is gone from /work route");
const privacy=fs.readFileSync(new URL("../privacy.html",import.meta.url),"utf8");ok(privacy.includes("Private AI Bridge web app")&&privacy.includes("IndexedDB")&&privacy.includes("resumable-job"),"privacy distinguishes private PWA storage");
fs.unlinkSync(tmp);console.log("All v4.9.5 security/sync tests passed.");
