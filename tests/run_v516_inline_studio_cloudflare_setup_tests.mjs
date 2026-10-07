import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const html=read("index.html"),app=read("app.js"),i18n=read("i18n.js"),workerText=read("_worker.js"),meta=JSON.parse(read("bridge-version.json"));
const [major,minor,patch]=String(meta.version).split(".").map(Number);

ok(major>5||(major===5&&(minor>1||(minor===1&&patch>=6))),"version retains the v5.1.6+ Studio REST feature set");
ok(html.includes('data-token-card="cloudflare_account"')&&html.includes('data-token-card="cloudflare_ai"'),"Connections exposes Cloudflare Account ID and Workers AI token fields");
ok(html.includes('data-save-provider-token="cloudflare_ai"')&&html.includes('data-delete-provider-token="cloudflare_ai"'),"Cloudflare REST credentials have save and delete controls");
ok(app.includes('saveProviderToken')&&app.includes('deleteProviderToken')&&app.includes('/api/provider-tokens'),"Studio credentials use the shared protected mobile vault API");
ok(i18n.includes('cloudflareRestSetup')&&i18n.includes('cloudflareRestHelp'),"REST setup has localized explanatory copy");
ok(workerText.includes('handleProviderTokens')&&workerText.includes('sameOriginMutation'),"worker protects credential mutation with authenticated same-origin handling");
ok(workerText.includes('cloudflareAIRestToken')&&workerText.includes('/ai/run/${CLOUDFLARE_IMAGE_MODEL}'),"Studio keeps the official account-scoped Workers AI REST fallback");

const mod=await import(pathToFileURL(path.join(root,"_worker.js")).href+`?t=${Date.now()}`);
const account="0123456789abcdef0123456789abcdef",token="cf-test-workers-ai-token";
const env={__mobileProviderTokens:{cloudflare_account:account,cloudflare_ai:token}};
ok(mod.cloudflareAIAvailable(env)&&mod.cloudflareAIEngine(env)==="rest","saved mobile credentials activate the REST image engine");
ok(mod.cloudflareAIAccountId(env)===account&&mod.cloudflareAIRestToken(env)===token,"REST engine reads both vault values without exposing them in UI markup");

const originalFetch=globalThis.fetch;
try{
  let seenUrl="",seenAuth="";
  globalThis.fetch=async(url,init={})=>{
    seenUrl=String(url);seenAuth=String(new Headers(init.headers||{}).get("authorization")||"");
    return new Response(JSON.stringify({success:true,result:{image:"aGVsbG8="}}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  const result=await mod.runCloudflareImage(env,"photo-generate","a safe test image",null,"standard");
  ok(result.transport==="rest"&&result.image_url==="data:image/jpeg;base64,aGVsbG8=","REST fallback returns a renderable image data URL");
  ok(seenUrl.includes(`/accounts/${account}/ai/run/`)&&seenAuth===`Bearer ${token}`,"REST request uses the account-scoped endpoint and Bearer authorization");
} finally {globalThis.fetch=originalFetch}

console.log(`AI Bridge v${meta.version} Studio REST continuity tests passed.`);
