import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)};

vm.runInThisContext(read("zip-safety-core.js"));
const Z=globalThis.ZipSafetyCore;
function eocd(entries,cdOffset){const b=Buffer.alloc(22);b.writeUInt32LE(0x06054b50,0);b.writeUInt16LE(entries,8);b.writeUInt16LE(entries,10);b.writeUInt32LE(0,12);b.writeUInt32LE(cdOffset,16);return b}
function central(name){const n=Buffer.from(name),b=Buffer.alloc(46+n.length);b.writeUInt32LE(0x02014b50,0);b.writeUInt16LE(n.length,28);n.copy(b,46);return b}
function fakeZip(entries){const cd=Buffer.concat(Array.from({length:entries},(_,i)=>central(`project/file-${i}.js`)));return new Uint8Array(Buffer.concat([cd,eocd(entries,0)]))}

ok(Z.DEFAULTS.maxEntries===512,"shared ZIP safety cap is 512 entries");
ok(Z.scanZipMeta(fakeZip(203)).entries===203,"the 203-entry full AI Bridge package is accepted as file context");
let blocked=false;try{Z.scanZipMeta(fakeZip(513))}catch(e){blocked=/too many entries/.test(String(e.message))}
ok(blocked,"entry-count ZIP-bomb protection still rejects archives above 512 entries");
ok(read("app.js").includes("const ZIP_MAX_ENTRIES=512;"),"Files & ZIP UI uses the corrected cap");
ok(read("_worker.js").includes("const ZIP_MAX_ENTRIES=512;"),"Worker ZIP extraction uses the corrected cap");
ok(read("work-controller.js").includes("const WORK_MAX_ZIP_ENTRIES=512;"),"Work Controller ZIP extraction uses the corrected cap");
ok(read("zip-safety-core.js").includes("maxTotalDeclared:16000000")&&read("zip-safety-core.js").includes("maxCompressionRatio:120"),"size and compression-ratio ZIP-bomb protections remain enabled");

console.log("AI Bridge v5.3.6 full-project ZIP entry-limit tests passed.");
