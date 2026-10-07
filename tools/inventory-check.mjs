#!/usr/bin/env node
/* Compare the current project file inventory against a baseline directory.
   Usage: node tools/inventory-check.mjs <baselineDir> [--allow-removed file1,file2]
   Exits 1 when a baseline file is missing and not explicitly justified. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const baseline=path.resolve(process.argv[2]||"");
if(!process.argv[2]||!fs.existsSync(baseline)){console.error("Usage: node tools/inventory-check.mjs <baselineDir>");process.exit(2)}
const allowIdx=process.argv.indexOf("--allow-removed");
const allowed=new Set(allowIdx>0?String(process.argv[allowIdx+1]||"").split(",").map(x=>x.trim()).filter(Boolean):[]);
function list(dir){
  const out=[];
  (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name===".git"||e.name==="node_modules")continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else out.push(path.relative(dir,p).replaceAll(path.sep,"/"))}})(dir);
  return new Set(out);
}
const base=list(baseline),cur=list(root);
const missing=[...base].filter(f=>!cur.has(f)).sort(),added=[...cur].filter(f=>!base.has(f)).sort();
const unjustified=missing.filter(f=>!allowed.has(f));
console.log(JSON.stringify({baselineFiles:base.size,currentFiles:cur.size,missing,unjustifiedMissing:unjustified,added},null,2));
process.exit(unjustified.length?1:0);
