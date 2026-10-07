/* AI Bridge v5.8.1 full-project ZIP and Search First regression tests. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const ok=(value,message)=>{if(!value)throw new Error(`FAIL: ${message}`);console.log("✓",message)};

vm.runInThisContext(read("zip-safety-core.js"));
const Z=globalThis.ZipSafetyCore;
function eocd(entries,cdOffset){const b=Buffer.alloc(22);b.writeUInt32LE(0x06054b50,0);b.writeUInt16LE(entries,8);b.writeUInt16LE(entries,10);b.writeUInt32LE(0,12);b.writeUInt32LE(cdOffset,16);return b}
function central(name,comp,uncomp){const n=Buffer.from(name),b=Buffer.alloc(46+n.length);b.writeUInt32LE(0x02014b50,0);b.writeUInt32LE(comp,20);b.writeUInt32LE(uncomp,24);b.writeUInt16LE(n.length,28);n.copy(b,46);return b}
function fakeZip(sizes){const cd=Buffer.concat(sizes.map((uncomp,i)=>central(`project/file-${i}.js`,Math.ceil(uncomp/2),uncomp)));return new Uint8Array(Buffer.concat([cd,eocd(sizes.length,0)]))}
function splitTotal(total,count){const base=Math.floor(total/count),out=Array(count).fill(base);out[0]+=total-base*count;return out}

ok(Z.DEFAULTS.maxTotalDeclared===16_000_000,"shared ZIP total cap is 16 MB");
const exactFullPackage=Z.scanZipMeta(fakeZip(splitTotal(14_342_742,8)));
ok(exactFullPackage.totalDeclared===14_342_742,"the exact v5.8.0 full-package declared size is accepted");
let overBudget=false;try{Z.scanZipMeta(fakeZip(splitTotal(16_000_001,9)))}catch(error){overBudget=/declared total size too large/.test(String(error.message))}
ok(overBudget,"an archive one byte above the 16 MB budget is rejected");
for(const [file,needle] of [["app.js","ZIP_MAX_TOTAL_DECOMPRESSED=16_000_000"],["zip-worker.js","ZIP_MAX_TOTAL_DECOMPRESSED=16_000_000"],["_worker.js","ZIP_MAX_TOTAL_DECOMPRESSED=16_000_000"],["work-controller.js","WORK_MAX_TOTAL_DECOMPRESSED=16000000"],["zip-safety-core.js","maxTotalDeclared:16000000"]])ok(read(file).includes(needle),`${file} uses the synchronized 16 MB cap`);

const worker=read("_worker.js"),searchBlock=worker.slice(worker.indexOf("async function searchPublicFallback"),worker.indexOf("async function agentSearchWeb"));
ok(searchBlock.indexOf('{provider:"bing"')<searchBlock.indexOf('{provider:"duckduckgo"'),"Bing RSS precedes DuckDuckGo HTML in public fallback order");
ok(worker.includes('searchJson(url,{headers:{Accept:"application/json"}},3500)'),"DuckDuckGo Instant Answer has the bounded 3.5 second timeout");
ok(!worker.includes("function localGreetingText"),"no local fake greeting responder remains");
ok(worker.includes("maxCompressionRatio:120")||read("zip-safety-core.js").includes("maxCompressionRatio:120"),"compression-ratio protection remains enabled");

console.log("AI Bridge v5.8.1 full ZIP reliability tests passed.");
