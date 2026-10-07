import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
function files(dir=root){
  const out=[];
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    if(e.name===".git"||e.name==="node_modules"||e.name==="releases"||e.name==="improvements"||e.name==="MANIFEST.sha256.json"||e.name.endsWith(".zip"))continue;
    const p=path.join(dir,e.name);
    if(e.isDirectory())out.push(...files(p));
    else if(!/^worker-v\d+.*\.mjs$/.test(e.name))out.push(p);
  }
  return out;
}
const h=crypto.createHash("sha256");
for(const p of files().sort()){
  const rel=path.relative(root,p).replaceAll(path.sep,"/");
  let data=fs.readFileSync(p);
  if(rel==="_worker.js")data=Buffer.from(data.toString("utf8").replace(/const BUILD_SHA256="[^"]+";/,'const BUILD_SHA256="<normalized>";'));
  if(rel==="bridge-version.json"){
    const j=JSON.parse(data.toString("utf8"));j.buildSha256="<normalized>";data=Buffer.from(JSON.stringify(j,null,2)+"\n");
  }
  h.update(rel);h.update("\0");h.update(data);h.update("\0");
}
const buildSha256=h.digest("hex"),metaPath=path.join(root,"bridge-version.json"),meta=JSON.parse(fs.readFileSync(metaPath,"utf8"));
meta.buildSha256=buildSha256;fs.writeFileSync(metaPath,JSON.stringify(meta,null,2)+"\n");
console.log(buildSha256);
