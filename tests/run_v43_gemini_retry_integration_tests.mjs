import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),tmp=new URL("./worker-v43-gemini.mjs",import.meta.url);fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
const originalFetch=globalThis.fetch;let calls=0;
globalThis.fetch=async()=>{
  calls++;
  if(calls===1)return new Response(JSON.stringify({error:{message:"quota",details:[{"@type":"type.googleapis.com/google.rpc.RetryInfo",retryDelay:"0.02s"}]}}),{status:429,headers:{"content-type":"application/json"}});
  return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"summary":"ok","findings":[]}'}]}}]}),{status:200,headers:{"content-type":"application/json"}});
};
const events=[],diag={provider:"gemini"},started=Date.now();
try{
  const text=await m.callJudgeStructuredNative({GOOGLE_API_KEY:"test"},"gemini","system","prompt",diag,e=>events.push(e));
  const elapsed=Date.now()-started,retry=events.find(e=>e.type==="judge_retry");
  ok(calls===2,"Gemini retries after 429");ok(elapsed>=15,"Gemini respects RetryInfo delay");ok(text.includes('"findings":[]'),"second Gemini response succeeds");
  ok(retry?.attempt===1&&retry?.nextAttempt===2&&retry?.maxAttempts===2,"stream diagnostics expose 1/2 -> 2/2");
  ok(retry?.status===429,"stream diagnostics expose 429");ok(retry?.retryDelaySource==="google.rpc.RetryInfo","stream diagnostics expose RetryInfo source");ok(retry?.retryDelayMs>=20,"stream diagnostics expose server delay");
}finally{globalThis.fetch=originalFetch;fs.unlinkSync(tmp)}
console.log("All v4.3 Gemini retry integration tests passed.");
