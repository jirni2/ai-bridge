import fs from "node:fs";
import vm from "node:vm";
import zlib from "node:zlib";
vm.runInThisContext(fs.readFileSync(new URL("../zip-safety-core.js",import.meta.url),"utf8"));
const Z=globalThis.ZipSafetyCore;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
function expectThrow(fn,part,msg){let yes=false;try{fn()}catch(e){yes=String(e.message).includes(part)}ok(yes,msg)}
async function expectThrowAsync(fn,part,msg){let yes=false;try{await fn()}catch(e){yes=String(e.message).includes(part)}ok(yes,msg)}
function eocd(entries,cdOffset){const b=Buffer.alloc(22);b.writeUInt32LE(0x06054b50,0);b.writeUInt16LE(entries,8);b.writeUInt16LE(entries,10);b.writeUInt32LE(0,12);b.writeUInt32LE(cdOffset,16);return b}
function central(name,comp,uncomp){const n=Buffer.from(name),b=Buffer.alloc(46+n.length);b.writeUInt32LE(0x02014b50,0);b.writeUInt32LE(comp,20);b.writeUInt32LE(uncomp,24);b.writeUInt16LE(n.length,28);n.copy(b,46);return b}
function fakeZip(meta,count=meta.length){const cd=Buffer.concat(meta.map((x,i)=>central(`f${i}.js`,x.comp,x.uncomp)));return new Uint8Array(Buffer.concat([cd,eocd(count,0)]))}
ok(Z.scanZipMeta(fakeZip(Array.from({length:203},()=>({comp:0,uncomp:0})))).entries===203,"203-entry full AI Bridge ZIP is accepted");
expectThrow(()=>Z.scanZipMeta(fakeZip([],513)),"too many entries","513-entry ZIP is rejected");
expectThrow(()=>Z.scanZipMeta(fakeZip([{comp:10,uncomp:5000}])),"compression ratio too high","high compression ratio is rejected");
expectThrow(()=>Z.scanZipMeta(fakeZip([{comp:100,uncomp:2100000}])),"declared size too large","oversized declared entry is rejected");
expectThrow(()=>Z.scanZipMeta(fakeZip(Array.from({length:9},()=>({comp:1000000,uncomp:1800000})))),"declared total size too large","declared total budget is enforced");
const badLastCentral=Buffer.alloc(46);badLastCentral.writeUInt32LE(0x02014b50,0);badLastCentral.writeUInt16LE(60000,28);
expectThrow(()=>Z.scanZipMeta(new Uint8Array(Buffer.concat([badLastCentral,eocd(1,0)]))),"entry length","last central-directory entry cannot extend past EOCD");
const compressed=zlib.deflateRawSync(Buffer.alloc(300000,65));
await expectThrowAsync(()=>Z.inflateRawBounded(new Uint8Array(compressed),50000),"decompressed byte limit","actual streaming decompression aborts over byte limit");
console.log("All v3.9 ZIP safety behavior tests passed.");
