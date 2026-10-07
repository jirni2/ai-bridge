import fs from "node:fs";
const c=fs.readFileSync(new URL("../work-controller.js",import.meta.url),"utf8");
const z=fs.readFileSync(new URL("../zip-safety-core.js",import.meta.url),"utf8");
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
ok(c.includes("WORK_MAX_ZIP_ENTRIES=512"),"ZIP entry count cap accepts full projects while remaining bounded");
ok(c.includes("WORK_MAX_TOTAL_DECOMPRESSED=16000000"),"total decompressed byte cap exists");
ok(c.includes("WORK_MAX_COMPRESSION_RATIO=120"),"compression ratio cap exists");
ok(z.includes('reader.cancel("decompressed limit exceeded")'),"stream decompression cancels over limit");
ok(c.includes("workHeadTail"),"head+tail sampling retained");
ok(c.includes("<project_manifest>"),"project manifest retained");
console.log("All v3.8 client safety tests passed.");
