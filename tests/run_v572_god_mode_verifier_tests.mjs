import fs from "node:fs";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import path from "node:path";

const root=path.resolve(new URL("..",import.meta.url).pathname);
const worker=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const mod=await import(pathToFileURL(path.join(root,"_worker.js")).href+`?t=${Date.now()}`);

assert.ok(mod.GOD_MODE_DOCTRINE.includes("exact URL or domain"),"God Mode anchors identity to an exact user-supplied target");
assert.ok(mod.GOD_MODE_DOCTRINE.includes("never substitute search results for a namesake product"),"God Mode rejects namesake-product substitution");
assert.ok(worker.includes('tool:"independent_verify"'),"God Mode exposes the independent verification progress phase");
assert.ok(worker.includes("verificationTimedOut"),"God Mode reports verifier timeout honestly");

const oldFetch=globalThis.fetch;
try{
  globalThis.fetch=async (_url,opts={})=>new Promise((resolve,reject)=>{
    const fail=()=>reject(Object.assign(new Error("aborted"),{name:"AbortError"}));
    if(opts.signal?.aborted)return fail();
    opts.signal?.addEventListener("abort",fail,{once:true});
  });
  const results=[],started=Date.now();
  const checked=await mod.agentVerifyDraft({GROQ_API_KEY:"test"},{providerIds:["groqfree"],task:"verify",draft:"draft",observations:[],results,verificationTimeoutMs:40});
  assert.equal(checked.verifiedBy,null);
  assert.equal(checked.timedOut,true);
  assert.ok(Date.now()-started<1000,"verifier timeout is bounded instead of inheriting provider retry budgets");
  assert.equal(results.length,1,"one timed-out provider produces one diagnostic result");
} finally {globalThis.fetch=oldFetch}

console.log("AI Bridge v5.7.2 God Mode verifier tests passed (8 assertions).");
