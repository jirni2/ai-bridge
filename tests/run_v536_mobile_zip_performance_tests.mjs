import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const fn=app.slice(app.indexOf("async function unzipText(file"),app.indexOf("function isSupportedPickedFile"));

ok(fn.includes("candidates=[]"),"ZIP extraction first collects central-directory metadata");
ok(fn.indexOf("candidates.sort(")<fn.indexOf("for(const c of candidates)"),"ZIP entries are prioritized before any extraction loop");
// v5.9.2: extraction budget is device-side 8M; each request remains capped by MAX_CONTEXT_CHARS in buildFileContext().
ok(fn.includes("if(used>=ZIP_EXTRACT_MAX_CHARS||totalDecompressed>=ZIP_MAX_TOTAL_DECOMPRESSED)break")&&app.includes("const ZIP_EXTRACT_MAX_CHARS=8_000_000;"),"extraction stops once the device extraction or byte budget is full");
ok(!fn.includes("rows.sort("),"mobile path no longer inflates every entry and sorts afterward");
ok(fn.includes("processed%8===0")&&fn.includes("setTimeout(resolve,0)"),"large projects yield to Safari between bounded extraction batches");
ok(app.includes("const ZIP_MAX_ENTRIES=512;")&&app.includes("const ZIP_MAX_TOTAL_DECOMPRESSED=16_000_000;"),"entry and decompressed-size ZIP-bomb limits remain active");

console.log("AI Bridge v5.3.6 mobile ZIP performance regression tests passed.");
