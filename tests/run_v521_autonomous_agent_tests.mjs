import fs from "node:fs";
import assert from "node:assert/strict";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),tmp=new URL("./worker-v521-under-test.mjs",import.meta.url);fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());
// v5.2.2 intentionally supersedes the Gemini-led behavior introduced in v5.2.1.
assert.equal(m.agentCoreAvailable({AI:{run(){}}}),true);
assert.equal(m.agentCoreAvailable({GOOGLE_API_KEY:"g"}),true,"A connected provider can power the Bridge-controlled Agent loop");
assert.deepEqual(m.agentControllerOrder(["openrouter","gemini","groqfree"]),["openrouter","gemini","groqfree"],"No hidden Gemini-first controller order");
assert.equal(m.agentDelegateOrder(["gemini","groqfree","openrouter"],"gemini")[0],"gemini","Explicit helper choice is respected");
assert.equal(m.agentDelegateOrder(["gemini","groqfree","openrouter"],"auto")[0],"groqfree","Auto helper selection can prefer an economical specialist without making it the controller");
fs.unlinkSync(tmp);
console.log("Agent regression updated: AI Bridge owns the loop and connected providers supply structured decisions");
