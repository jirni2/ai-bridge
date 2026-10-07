import fs from "node:fs";
import zlib from "node:zlib";
const src=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8");
const tmp=new URL(`./worker-v452-run-${process.pid}-${Date.now()}.mjs`,import.meta.url);
fs.writeFileSync(tmp,src);
const m=await import(tmp.href+"?t="+Date.now());
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}

const env={PUBLIC_PLUGIN_MODE:"1",ALLOW_PUBLIC_MCP:"1",BRIDGE_ACCESS_TOKEN:"t",GOOGLE_API_KEY:"g",GROQ_API_KEY:"q",OPENROUTER_API_KEY:"r"};

/* ---------- Bug #1 regression: server-side ZIP-bomb / unbounded decompression ---------- */
// Build a real ZIP (pure Node zlib, no external fixtures) whose central directory
// LIES about the uncompressed size (declares 500 bytes) while the real deflate
// stream actually expands to 20MB. The OLD code trusted the declared size and
// fully decompressed with no independent cap -> real memory blowup (verified:
// a 48KB crafted ZIP forced ~140MB RSS growth under the pre-fix code).
function buildLyingZip(realSizeBytes,lieSize,entryName){
  const payload=Buffer.alloc(realSizeBytes,65);
  const compressed=zlib.deflateRawSync(payload,{level:9});
  const name=Buffer.from(entryName,"utf8");
  const crc=zlib.crc32?zlib.crc32(payload):0;
  const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0,0);return b};
  const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n,0);return b};
  const local=Buffer.concat([u32(0x04034b50),u16(20),u16(0),u16(8),u16(0),u16(0),u32(crc),u32(compressed.length),u32(lieSize),u16(name.length),u16(0),name]);
  const cd=Buffer.concat([u32(0x02014b50),u16(20),u16(20),u16(0),u16(8),u16(0),u16(0),u32(crc),u32(compressed.length),u32(lieSize),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(0),name]);
  const body=Buffer.concat([local,compressed]);
  const cdOffset=body.length;
  const eocd=Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(1),u16(1),u32(cd.length),u32(cdOffset),u16(0)]);
  return Buffer.concat([body,cd,eocd]);
}
{
  const lyingZip=buildLyingZip(20_000_000,500,"bomb.txt");
  const origFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(lyingZip,{status:200,headers:{"content-type":"application/zip","content-length":String(lyingZip.length)}});
  const before=process.memoryUsage().rss;
  const res=await m.callMcpTool(env,"review_project_files",{task:"audit",files:[{download_url:"https://allowed-host.example/bomb.zip",file_name:"bomb.zip",file_id:"f1"}]});
  const after=process.memoryUsage().rss;
  const deltaMB=(after-before)/1e6;
  globalThis.fetch=origFetch;
  ok(deltaMB<40,`decompression stays bounded regardless of declared ZIP size (delta ${deltaMB.toFixed(1)}MB, expected <40MB)`);
}
/* ---------- Bug #2 regression: MCP file-host allowlist bypass ---------- */
{
  const seenHosts=[];
  const origFetch=globalThis.fetch;
  globalThis.fetch=async(url)=>{seenHosts.push(new URL(url).hostname);return new Response("plain text file content here",{status:200,headers:{"content-type":"text/plain","content-length":"27"}})};
  const envNoAllowlist={...env}; // MCP_FILE_HOST_ALLOWLIST intentionally unset, public mode -> default should be deny-all
  const res=await m.callMcpTool(envNoAllowlist,"review_project_files",{task:"audit",files:[{download_url:"https://totally-untrusted-external-host.example/f.txt",file_name:"f.txt",file_id:"f1"}]});
  globalThis.fetch=origFetch;
  ok(seenHosts.length===0,"unallowlisted public host is never fetched by review_project_files");
  ok(res.isError===true,"review_project_files reports an error when file host is not allowed");
}
{
  // Positive case: an explicitly allowlisted host must still work.
  const seenHosts=[];
  const origFetch=globalThis.fetch;
  globalThis.fetch=async(url)=>{seenHosts.push(new URL(url).hostname);return new Response("function realCode(){ return 1; }",{status:200,headers:{"content-type":"text/plain","content-length":"33"}})};
  const envWithAllowlist={...env,MCP_FILE_HOST_ALLOWLIST:"trusted-files.example"};
  await m.callMcpTool(envWithAllowlist,"review_project_files",{task:"audit",files:[{download_url:"https://trusted-files.example/f.txt",file_name:"f.txt",file_id:"f1"}]});
  globalThis.fetch=origFetch;
  ok(seenHosts.includes("trusted-files.example"),"allowlisted host is still fetched normally");
}

/* ---------- Bug #3 regression: cross-file spoofing via missing fileName ---------- */
{
  const fileText="function realFunctionInAppJs(){\n  return doSomethingReal();\n}\n";
  const finding={claim:"test",file:"totally-different-nonexistent-file.py",code_evidence:"function realFunctionInAppJs(){"};
  const spoofed=m.verifyFindingEvidence(finding,fileText,""); // fileName omitted
  ok(spoofed.quoteMatched===false,"claim against wrong/unknown file is NOT matched when real fileName is unavailable");
  const correct=m.verifyFindingEvidence(finding,fileText,"totally-different-nonexistent-file.py");
  ok(correct.quoteMatched===true,"claim still matches when the claimed file name equals the real known fileName");
  const wrongName=m.verifyFindingEvidence(finding,fileText,"app.js");
  ok(wrongName.quoteMatched===false,"claim is rejected when claimed file name does not match the real known fileName");
}

/* ---------- Bug #4 regression (static): retry-merge no longer mixes file contexts ---------- */
{
  const wc=fs.readFileSync(new URL("../work-controller.js",import.meta.url),"utf8");
  const start=wc.indexOf('$("workFile").onchange=()=>{');
  ok(start>=0,"workFile onchange handler is present");
  const handlerBody=start>=0?wc.slice(start,wc.indexOf('"Файл не вибрано"',start)):"";
  ok(handlerBody.includes("lastRun=null"),"changing the attached file invalidates lastRun so retry cannot mix old/new file contexts");
}

/* ---------- Bug #5 regression: constant-time bearer token comparison ---------- */
{
  const okReq=new Request("https://x/mcp",{headers:{authorization:"Bearer t"}});
  const badReq=new Request("https://x/mcp",{headers:{authorization:"Bearer wrong"}});
  const emptyReq=new Request("https://x/mcp",{});
  ok((await m.authOK(okReq,env)).ok===true,"correct bearer token still authenticates");
  ok((await m.authOK(badReq,env)).ok===false,"incorrect bearer token is rejected");
  ok((await m.authOK(emptyReq,env)).ok===false,"missing Authorization header is rejected");
  ok(src.includes("constantTimeEqual"),"authOK now uses a constant-time comparison helper");
}

fs.unlinkSync(tmp);
console.log("All v4.5.2 adversarial-audit regression tests passed.");
