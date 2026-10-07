import fs from "node:fs";
import vm from "node:vm";
import zlib from "node:zlib";

const read=file=>fs.readFileSync(new URL(`../${file}`,import.meta.url),"utf8");
const app=read("app.js"),workerSource=read("zip-worker.js"),sw=read("sw.js"),server=read("_worker.js");
let pass=0;const ok=(v,m)=>{if(!v)throw new Error(m);pass++;console.log(`PASS ${m}`)};
ok(app.includes("async function unzipTextOffMainThread")&&app.includes('new Worker("./zip-worker.js"'),"Files extracts ZIP projects in a dedicated Web Worker");
ok(app.includes("worker.postMessage({buffer},[buffer])"),"ZIP bytes transfer to the worker without a second main-thread copy");
ok(app.includes("45000")&&app.includes("worker.terminate()"),"ZIP worker has a bounded timeout and cleanup");
ok(app.includes("await unzipTextOffMainThread(f"),"the production file picker uses off-main-thread extraction");
ok(sw.includes('"./zip-worker.js"')&&server.includes('"/zip-worker.js"'),"ZIP worker is precached and served as a critical static asset");
ok(workerSource.includes("scanZipMeta")&&workerSource.includes("ZIP_MAX_ENTRIES=512")&&workerSource.includes("ZIP_MAX_TOTAL_DECOMPRESSED=16_000_000"),"worker retains entry, size and ZIP-bomb checks");
ok(workerSource.includes("ZIP_EXTRACT_MAX_CHARS=8000000")&&workerSource.includes("candidates.sort("),"worker prioritizes source files and enforces the context budget");

// Exercise the worker protocol with a small stored ZIP assembled without dependencies.
const name=Buffer.from("src/main.js"),data=Buffer.from("export const ready = true;\n"),crc=(()=>{let c=0xffffffff;for(const b of data){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0})();
const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);
const cdOffset=local.length+name.length+data.length,cdSize=central.length+name.length,eocd=Buffer.alloc(22);eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(1,8);eocd.writeUInt16LE(1,10);eocd.writeUInt32LE(cdSize,12);eocd.writeUInt32LE(cdOffset,16);
const zip=Buffer.concat([local,name,data,central,name,eocd]);
const messages=[],sandbox={TextDecoder,DataView,Uint8Array,Blob,DecompressionStream,setTimeout,clearTimeout,console};sandbox.self=sandbox;sandbox.postMessage=m=>messages.push(m);sandbox.importScripts=()=>vm.runInContext(read("zip-safety-core.js"),sandbox);vm.createContext(sandbox);vm.runInContext(workerSource,sandbox);await sandbox.onmessage({data:{buffer:zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength)}});
const done=messages.find(x=>x.type==="done");ok(done?.files?.[0]?.name==="src/main.js"&&done.files[0].text.includes("ready = true"),"worker extracts a real ZIP entry and returns its text");
ok(app.includes("sampleLargeFileText(decoded,ZIP_FILE_SAMPLE_CHARS)")&&workerSource.includes("sampleLargeFileText(decoded,ZIP_FILE_SAMPLE_CHARS)"),"Safari fallback and worker share a bounded per-entry ZIP sample");
ok(server.includes("do not claim a complete project audit from a partial sample")&&server.includes("Do not infer whether external API models exist"),"file task response requires evidence and marks unsupported model claims unverified");

// Twelve source entries must remain available to device-side Deep Scan.
// The per-request 350k budget is enforced later by buildFileContext().
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0};
const parts=[],directory=[];let offset=0;
for(let i=0;i<12;i++){
  const n=Buffer.from(`src/module-${String(i).padStart(2,"0")}.js`),body=Buffer.from(`// module ${i}\n`+"export const line = 1234567890;\n".repeat(1900)),sum=crc32(body);
  const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt32LE(sum,14);lh.writeUInt32LE(body.length,18);lh.writeUInt32LE(body.length,22);lh.writeUInt16LE(n.length,26);
  const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);ch.writeUInt32LE(sum,16);ch.writeUInt32LE(body.length,20);ch.writeUInt32LE(body.length,24);ch.writeUInt16LE(n.length,28);ch.writeUInt32LE(offset,42);
  parts.push(lh,n,body);directory.push(ch,n);offset+=lh.length+n.length+body.length;
}
const cd=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(12,8);end.writeUInt16LE(12,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
const broadZip=Buffer.concat([...parts,cd,end]);messages.length=0;
await sandbox.onmessage({data:{buffer:broadZip.buffer.slice(broadZip.byteOffset,broadZip.byteOffset+broadZip.byteLength)}});
const broad=messages.find(x=>x.type==="done");ok(broad?.files?.length===12&&broad.files.every(f=>f.text.length<=181200)&&broad.files.every(f=>!f.truncated),"large ZIP retains all safe source text when it fits the 8M device budget");
ok(broad.manifestNames.length===12&&broad.manifestNames.includes("src/module-11.js"),"ZIP preserves the full readable-file inventory independently of excerpt budget");
console.log(`AI Bridge v5.3.8 ZIP worker regression tests passed (${pass}).`);
