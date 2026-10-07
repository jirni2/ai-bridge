import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
let failures=0;
function ok(cond,msg){if(cond)console.log(`✓ ${msg}`);else{console.error(`✗ ${msg}`);failures++}}
function exists(rel){return fs.existsSync(path.join(root,rel))}

for(const rel of ["icon-180.png","icon-192.png","icon-512.png","plugin.html","oauth-replay-do.js","SUBMISSION_CHECKLIST.txt"]){
  ok(exists(rel),`${rel} is packaged`);
}

const index=fs.readFileSync(path.join(root,"index.html"),"utf8");
ok(!index.includes('href="icon-180.png"')||exists("icon-180.png"),"index apple-touch icon target exists");

const manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.webmanifest"),"utf8"));
for(const icon of manifest.icons||[]){
  const rel=String(icon.src||"").replace(/^\.\//,"");
  ok(!!rel&&exists(rel),`manifest icon target exists: ${icon.src}`);
}

const sw=fs.readFileSync(path.join(root,"sw.js"),"utf8");
const m=sw.match(/const ASSETS=(\[[^;]+\]);/);
ok(!!m,"service-worker precache list is parseable");
if(m){
  const assets=JSON.parse(m[1]);
  for(const asset of assets){
    const rel=String(asset).replace(/^\.\//,"");
    ok(exists(rel),`service-worker precache target exists: ${asset}`);
  }
}

const replaySetup=fs.readFileSync(path.join(root,"OAUTH_REPLAY_DO_SETUP.txt"),"utf8");
ok(!replaySetup.includes("oauth-replay-do.js")||exists("oauth-replay-do.js"),"OAuth replay setup's referenced worker is packaged");

if(failures){console.error(`v4.9.4 packaging integrity: ${failures} failure(s)`);process.exit(1)}
console.log("v4.9.4 packaging integrity tests passed.");
