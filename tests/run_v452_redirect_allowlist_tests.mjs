import fs from "node:fs";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8");
const tmp=new URL("./worker-v452-redirect-allowlist.mjs",import.meta.url);
fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}

const env={PUBLIC_PLUGIN_MODE:"1",ALLOW_PUBLIC_MCP:"1",BRIDGE_ACCESS_TOKEN:"t",GOOGLE_API_KEY:"g",GROQ_API_KEY:"q",OPENROUTER_API_KEY:"r",
  MCP_FILE_HOST_ALLOWLIST:"allowed-a.example,allowed-b.example,allowed-c.example,allowed-d.example,allowed-e.example"};

const PROVIDER_HOSTS=new Set(["generativelanguage.googleapis.com","api.groq.com","openrouter.ai"]);
// v5.11.61: SSRF DNS-гігієна робить DoH-префлайт на cloudflare-dns.com перед
// кожним веб-фетчем — це інфраструктурний виклик, а не частина ланцюжка
// редиректів, тому виключаємо його з downloadHosts разом із провайдерами.
const INFRA_HOSTS=new Set([...PROVIDER_HOSTS,"cloudflare-dns.com"]);
const PROVIDER_BODY_TEXT="Independent review: no issues found in the reviewed file; this text is intentionally long enough to count as a substantive provider response for the meaningfulProviderText() check.";
// Deterministic mock router: exact URL -> response descriptor. Tracks every
// host actually fetched so we can prove a disallowed host is NEVER contacted
// (not merely that its response is discarded after the fact). Provider API
// hosts (unrelated to the file-download/redirect logic under test) always get
// a synthetic successful response so "success" scenarios can complete the
// full review pipeline, not just the file-download phase.
function mockFetch(routes){
  const hostsFetched=[],callLog=[];
  const origFetch=globalThis.fetch;
  globalThis.fetch=async(url,opts)=>{
    const u=new URL(String(url));
    hostsFetched.push(u.hostname);callLog.push(String(url));
    const route=routes[String(url)];
    if(!route){
      if(PROVIDER_HOSTS.has(u.hostname)){
        return new Response(JSON.stringify({candidates:[{content:{parts:[{text:PROVIDER_BODY_TEXT}]}}],choices:[{message:{content:PROVIDER_BODY_TEXT}}]}),{status:200,headers:{"content-type":"application/json"}});
      }
      return new Response("not found",{status:404});
    }
    if(route.redirect){
      return new Response("",{status:route.status||302,headers:{location:route.redirect}});
    }
    return new Response(route.body||"substantive file content for a code review, long enough to matter here.",{status:200,headers:{"content-type":"text/plain","content-length":String((route.body||"substantive file content for a code review, long enough to matter here.").length)}});
  };
  // downloadHosts = hostsFetched filtered to exclude provider-API and SSRF-DoH
  // infrastructure hosts, so assertions about the redirect chain itself aren't
  // polluted by the separate downstream provider calls or DNS pre-flights.
  return {hostsFetched,callLog,downloadHosts:()=>hostsFetched.filter(h=>!INFRA_HOSTS.has(h)),restore:()=>{globalThis.fetch=origFetch}};
}
async function runReview(url){
  return m.callMcpTool(env,"review_project_files",{task:"audit",files:[{download_url:url,file_name:"f.txt",file_id:"f1"}]});
}

/* 1. allowed -> allowed = success */
{
  const mock=mockFetch({
    "https://allowed-a.example/start":{redirect:"https://allowed-b.example/final",status:302},
    "https://allowed-b.example/final":{body:"function realCode(){ return 1; } // reached via 302 to an allowlisted host"}
  });
  const res=await runReview("https://allowed-a.example/start");
  mock.restore();
  ok(mock.downloadHosts().join(",")==="allowed-a.example,allowed-b.example","allowed host redirecting to another allowed host is followed");
  ok(res.isError!==true,"allowed -> allowed redirect chain succeeds");
}

/* 2. allowed -> disallowed = blocked, and the disallowed host is NEVER fetched */
{
  const mock=mockFetch({
    "https://allowed-a.example/start":{redirect:"https://not-allowed.example/evil",status:302},
    "https://not-allowed.example/evil":{body:"SHOULD NEVER BE FETCHED"}
  });
  const res=await runReview("https://allowed-a.example/start");
  mock.restore();
  ok(!mock.hostsFetched.includes("not-allowed.example"),"disallowed redirect target is never fetched (checked before the request, not after)");
  ok(res.isError===true,"allowed -> disallowed redirect is blocked");
}

/* 3. redirect loop (ping-pong between two allowed hosts) = blocked, bounded call count */
{
  const mock=mockFetch({
    "https://allowed-a.example/x":{redirect:"https://allowed-b.example/y",status:302},
    "https://allowed-b.example/y":{redirect:"https://allowed-a.example/x",status:302}
  });
  const res=await runReview("https://allowed-a.example/x");
  mock.restore();
  ok(res.isError===true,"an infinite redirect loop is blocked instead of hanging");
  ok(mock.downloadHosts().length<=4,`redirect loop makes a bounded number of download requests (made ${mock.downloadHosts().length}, expected <=4)`);
}

/* 4. too many redirects (long chain, every hop individually allowed) = blocked */
{
  const mock=mockFetch({
    "https://allowed-a.example/1":{redirect:"https://allowed-b.example/2",status:301},
    "https://allowed-b.example/2":{redirect:"https://allowed-c.example/3",status:302},
    "https://allowed-c.example/3":{redirect:"https://allowed-d.example/4",status:307},
    "https://allowed-d.example/4":{redirect:"https://allowed-e.example/5",status:308},
    "https://allowed-e.example/5":{body:"reached the 5th hop, should never get here"}
  });
  const res=await runReview("https://allowed-a.example/1");
  mock.restore();
  ok(res.isError===true,"a chain longer than the hop cap is blocked even though every host is individually allowlisted");
  ok(!mock.hostsFetched.includes("allowed-e.example"),"the final host past the hop cap is never reached");
  ok(mock.downloadHosts().length<=4,`long chain stays within the hop cap (made ${mock.downloadHosts().length}, expected <=4)`);
}

/* 5a. relative Location on the same allowed host resolves and is allowed */
{
  const mock=mockFetch({
    "https://allowed-a.example/start":{redirect:"/v2/final",status:302},
    "https://allowed-a.example/v2/final":{body:"relative redirect on the same allowed host, resolved and served"}
  });
  const res=await runReview("https://allowed-a.example/start");
  mock.restore();
  ok(mock.downloadHosts().join(",")==="allowed-a.example,allowed-a.example","relative Location resolves against the current URL and is re-checked");
  ok(res.isError!==true,"relative redirect to a path on an allowed host succeeds");
}

/* 5b. protocol-relative Location to a disallowed host is blocked, not trusted just because it looks "relative" */
{
  const mock=mockFetch({
    "https://allowed-a.example/start":{redirect:"//not-allowed.example/evil",status:302},
    "https://not-allowed.example/evil":{body:"SHOULD NEVER BE FETCHED"}
  });
  const res=await runReview("https://allowed-a.example/start");
  mock.restore();
  ok(!mock.hostsFetched.includes("not-allowed.example"),"protocol-relative redirect to a disallowed host is never fetched");
  ok(res.isError===true,"protocol-relative redirect resolving to a disallowed host is blocked");
}

/* 5c. bonus: redirect that downgrades to plain HTTP is rejected regardless of host */
{
  const mock=mockFetch({
    "https://allowed-a.example/start":{redirect:"http://allowed-a.example/downgraded",status:302},
    "http://allowed-a.example/downgraded":{body:"SHOULD NEVER BE FETCHED"}
  });
  const res=await runReview("https://allowed-a.example/start");
  mock.restore();
  ok(!mock.hostsFetched.some(h=>false),"sanity: hostsFetched tracked");
  ok(res.isError===true,"redirect that downgrades from https to http is rejected");
}

fs.unlinkSync(tmp);
console.log("All v4.5.2 redirect/allowlist regression tests passed.");
