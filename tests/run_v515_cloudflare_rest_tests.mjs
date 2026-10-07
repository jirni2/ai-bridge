import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const worker=read("_worker.js"),app=read("app.js"),html=read("index.html"),i18n=read("i18n.js");
ok(worker.includes('"cloudflare_ai","cloudflare_account"'),"mobile vault includes Cloudflare Workers AI REST credentials");
ok(html.includes('data-token-card="cloudflare_account"')&&html.includes('data-token-card="cloudflare_ai"'),"Connections exposes Account ID and Workers AI token fields");
ok(app.includes('cloudflareAIEngine')&&app.includes('cloudflareAiRest'),"UI distinguishes binding vs REST Workers AI");
ok(i18n.includes('cloudflareRestSetup')&&i18n.includes('REST TOKEN ✓'),"REST setup is explained in UI copy");

const mod=await import(pathToFileURL(path.join(root,"_worker.js")).href+`?t=${Date.now()}`);
ok(mod.workersAIRestAvailable({CLOUDFLARE_ACCOUNT_ID:"0123456789abcdef0123456789abcdef",CLOUDFLARE_AI_API_TOKEN:"cf-token-123"})===true,"REST availability accepts Cloudflare env credentials");
ok(mod.cloudflareAIAvailable({AI:{run(){}}})===true&&mod.cloudflareAIAvailable({CLOUDFLARE_ACCOUNT_ID:"0123456789abcdef0123456789abcdef",CLOUDFLARE_AI_API_TOKEN:"cf-token-123"})===true,"Photo AI works with binding or REST credentials");

const originalFetch=globalThis.fetch;
try{
  let called="",auth="",contentType="";
  globalThis.fetch=async(url,init={})=>{
    called=String(url);auth=String(new Headers(init.headers||{}).get("authorization")||"");
    contentType=String(new Request("https://x.invalid",{method:"POST",body:init.body}).headers.get("content-type")||"");
    return new Response(JSON.stringify({success:true,result:{image:"AQID"},errors:[],messages:[]}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  const env={CLOUDFLARE_ACCOUNT_ID:"0123456789abcdef0123456789abcdef",CLOUDFLARE_AI_API_TOKEN:"cf-token-123"};
  const result=await mod.runCloudflareImage(env,"photo-generate","forest at sunrise",null,"standard");
  ok(called.includes('/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/black-forest-labs/flux-2-klein-4b'),"REST path uses official Workers AI account endpoint");
  ok(auth==="Bearer cf-token-123","REST path authenticates with Bearer token");
  ok(contentType.startsWith("multipart/form-data"),"REST image request uses multipart form data");
  ok(result.transport==="rest"&&result.image_url==="data:image/jpeg;base64,AQID","REST result is normalized for Studio");

  globalThis.fetch=async()=>new Response(JSON.stringify({success:false,errors:[{message:"Authentication error"}]}),{status:401,headers:{"Content-Type":"application/json"}});
  let failed=false;try{await mod.runCloudflareImage(env,"photo-generate","forest",null,"standard")}catch(e){failed=Number(e.status)===401&&/Authentication error/.test(String(e.message))}
  ok(failed,"REST auth errors propagate honestly without paid fallback");
} finally {globalThis.fetch=originalFetch}

console.log("AI Bridge v5.1.5 Cloudflare REST fallback tests passed.");
