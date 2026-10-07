import fs from "node:fs";
import assert from "node:assert/strict";

const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
let passed=0;const ok=(value,message)=>{assert.ok(value,message);passed++};

ok(app.includes("function providerDiagnosticError"),"Provider diagnostics use a dedicated safe error formatter");
ok(app.includes('status>=500||kind==="provider_unavailable"'),"Temporary provider failures have a friendly fallback message");
ok(app.includes('status===429||kind==="rate_limited"'),"Rate-limit failures have a dedicated safe label");
ok(!app.includes('${x.message||"error"}'),"Raw provider response messages are not rendered");
ok(app.includes('throw Object.assign(new Error("diagnostics_failed"),{status:r.status})'),"Top-level diagnostic errors discard response bodies");
ok(!app.includes('Provider diagnostics timed out after 20 seconds. Try again or test a provider individually.'),"Timeout copy does not imply an unavailable individual-test feature");
ok(app.includes('Provider diagnostics could not be completed${e?.status?` (HTTP ${e.status})`:""}. Try again.'),"Unexpected failures show only bounded status information");

console.log(`v5.4.2 diagnostic safety tests passed (${passed} assertions).`);
