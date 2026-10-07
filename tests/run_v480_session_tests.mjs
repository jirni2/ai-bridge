import fs from "node:fs";import assert from "node:assert/strict";
const w=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),a=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8"),wc=fs.readFileSync(new URL("../work-controller.js",import.meta.url),"utf8");
assert.match(w,/ai_bridge_session/);assert.match(w,/HttpOnly; Secure; SameSite=Strict/);assert.match(w,/\/api\/session\/login/);assert.match(w,/\/api\/session\/logout/);
assert.doesNotMatch(a,/sessionStorage\.setItem\(ACCESS_TOKEN_KEY/);assert.doesNotMatch(wc,/sessionStorage\.setItem\(ACCESS_TOKEN_KEY/);
assert.doesNotMatch(w,/greetingLike&&mode==="auto"\)return/);console.log("v4.8.0 session/runtime tests PASS");
