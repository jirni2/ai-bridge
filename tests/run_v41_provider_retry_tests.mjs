import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8"),tmp=new URL(`./worker-v41-provider-run-${process.pid}-${Date.now()}.mjs`,import.meta.url);fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
const realFetch=globalThis.fetch;
let groqCalls=0;
globalThis.fetch=async()=>{groqCalls++;if(groqCalls===1)return new Response(JSON.stringify({error:{message:"rate"}}),{status:429,headers:{"content-type":"application/json","retry-after":"0.001"}});return new Response(JSON.stringify({choices:[{message:{content:'{"summary":"ok","findings":[]}'}}]}),{status:200,headers:{"content-type":"application/json"}})};
const judgeText=await m.callJudgeStructuredNative({GROQ_API_KEY:"x",GROQ_MODEL:"model"},"groqfree","sys","prompt",{});
ok(groqCalls===2&&judgeText.includes('"summary":"ok"'),"Groq Judge retries real mocked 429 then succeeds");
let orCalls=0;
globalThis.fetch=async()=>{orCalls++;return new Response(JSON.stringify({choices:[{message:{content:orCalls===1?"":"This is a meaningful code review response with enough concrete content to be accepted by the Bridge provider retry path."}}]}),{status:200,headers:{"content-type":"application/json"}})};
const orText=await m.callOpenRouter({OPENROUTER_API_KEY:"x",OPENROUTER_MODEL:"model"},"sys","prompt");
ok(orCalls===2&&orText.includes("meaningful code review"),"OpenRouter 200 + empty content retries automatically and accepts second response");
globalThis.fetch=realFetch;fs.unlinkSync(tmp);console.log("All v4.1 provider/Judge retry tests passed.");
