import fs from "node:fs";
const root = new URL("../", import.meta.url);
const src = fs.readFileSync(new URL("../_worker.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const workController = fs.readFileSync(new URL("../work-controller.js", import.meta.url), "utf8");
const workHtml = fs.readFileSync(new URL("../work/index.html", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const tmp = new URL("./worker-v4511-security.mjs", import.meta.url);
fs.writeFileSync(tmp, src);
const m = await import(tmp.href + "?t=" + Date.now());
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}

ok(!app.includes('localStorage.setItem("ai_bridge_access_token"') && !workController.includes('localStorage.setItem("ai_bridge_access_token"'), "Bridge token is no longer persisted in localStorage in main UI or /work");
ok(!app.includes("sessionStorage.setItem(ACCESS_TOKEN_KEY"), "Bridge token is not persisted in sessionStorage");
ok(index.includes('id="forgetTokenBtn"') && workHtml.includes('id="clearWorkToken"'), "main UI and /work expose explicit token removal buttons");
ok(!index.includes("user-scalable=no"), "viewport no longer disables pinch zoom");
ok(/try\{[^}]*JSON\.parse\(localStorage\.getItem\("ai_bridge_selected"\)/s.test(app), "provider selection JSON.parse is guarded by try/catch");
ok(sw.includes('u.pathname.startsWith("/oauth/")') && sw.includes('u.pathname.startsWith("/.well-known/")') && sw.includes('u.pathname==="/mcp"'), "service worker bypasses OAuth, metadata, and MCP routes");
ok(sw.includes('r.headers.get("cache-control")') && sw.includes("no-store"), "service worker honors Cache-Control: no-store before cache.put");
ok(index.includes('href="/plugin"') && !index.includes('href="plugin.html"'), "public links use canonical extensionless paths");

const env = {
  BRIDGE_ACCESS_TOKEN:"secret",
  GOOGLE_API_KEY:"g",
  ASSETS:{fetch:async()=>new Response("<!doctype html><title>x</title>",{headers:{"Content-Type":"text/html"}})}
};
const invalid = await m.default.fetch(new Request("https://bridge.example/oauth/authorize?response_type=code&client_id=bad&redirect_uri=https%3A%2F%2Fevil.example%2Fcb&code_challenge_method=S256&code_challenge=x"),env);
const invalidBody = await invalid.text();
ok(invalid.status===400, "invalid OAuth request returns 400");
ok(!invalidBody.includes('<form method="post" action="/oauth/authorize">'), "invalid OAuth request does not render an active credential form");
ok(invalid.headers.get("x-frame-options")==="DENY", "OAuth page sends X-Frame-Options: DENY");
ok((invalid.headers.get("content-security-policy")||"").includes("frame-ancestors 'none'"), "OAuth page CSP blocks framing");
ok(invalid.headers.get("strict-transport-security")?.includes("max-age="), "OAuth page sends HSTS");
ok(invalid.headers.get("permissions-policy")?.includes("camera=(self)") && invalid.headers.get("permissions-policy")?.includes("microphone=(self)"), "Permissions-Policy permits only same-origin camera/microphone for explicit media controls");

const staticRes = await m.default.fetch(new Request("https://bridge.example/work/"),env);
ok(staticRes.headers.get("x-frame-options")==="DENY", "static /work response receives anti-framing header");
ok((staticRes.headers.get("content-security-policy")||"").includes("default-src 'self'"), "static /work response receives CSP");

const info = await m.default.fetch(new Request("https://bridge.example/api/mcp-info",{headers:{Authorization:"Bearer secret"}}),env);
ok(info.status===200, "/api/mcp-info exists in packaged worker");
const ij = await info.json();
ok(ij.ready===true && ij.providerCount>=1, "/api/mcp-info reports configured providers");

fs.unlinkSync(tmp);
console.log("All v4.5.11 security regression tests passed.");
