#!/usr/bin/env node
/* AI Bridge pre-release gate (v5.9.1). Run before every deploy:
     node tools/release-check.mjs [--baseline <previous-release-dir>] [--package]
   Checks (all must PASS):
     1. full regression suite + syntax check of every .js/.mjs/.cjs
     2. version sync: bridge-version.json = _worker VERSION = app/work UI_VERSION
        = sw.js CACHE = manifest name = index/work titles = support page
     3. service worker precache list points only at files that exist
     4. inventory: nothing from the baseline release is missing (with --baseline)
     5. writes MANIFEST.sha256.json (path -> sha256, size) for the package
   --package also writes releases/AI_Bridge_v<version>.zip and keeps older
   release ZIPs there for rollback. */
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";import {spawnSync} from "node:child_process";import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const args=process.argv.slice(2),results=[];
const check=(name,ok,detail="")=>{results.push({name,ok:!!ok,detail});console.log(`${ok?"PASS":"FAIL"}  ${name}${detail?` — ${detail}`:""}`)};
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const SKIP=/(?:^|\/)(?:\.git|node_modules|releases|improvements)(?:\/|$)|^tests\/worker-v[\w.-]*-\d{10,}\.mjs$|^MANIFEST\.sha256\.json$/;
function walk(dir=root){const out=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name),rel=path.relative(root,p).replaceAll(path.sep,"/");if(SKIP.test(rel))continue;if(e.isDirectory())out.push(...walk(p));else out.push(rel)}return out.sort()}

// 1. tests + syntax
const json=path.join(root,".release-tests.json");
const t=spawnSync(process.execPath,["tools/run-all-tests.mjs","--json",json],{cwd:root,encoding:"utf8",timeout:1800000,maxBuffer:128*1024*1024});
let sum=null;try{sum=JSON.parse(fs.readFileSync(json,"utf8"))}catch(e){}fs.rmSync(json,{force:true});
check("regression tests",t.status===0&&sum&&sum.fail===0,sum?`${sum.pass}/${sum.testFiles} test files, ${sum.passLines} checks`:"no summary");
for(const x of (sum?.results||[]).filter(x=>!x.ok))console.log(`      failed: ${x.test}\n${String(x.tail||"").split("\n").filter(l=>/FAIL|Error|assert/i.test(l)).slice(0,4).map(l=>"        "+l).join("\n")}`);
check("syntax check",sum&&!sum.syntaxFailures.length,sum?`${sum.syntaxChecked} files`:"");

// 1b. ESLint gate (v5.11.94, за аудитом v5.11.93): no-undef, no-const-assign,
// no-dupe-keys, no-redeclare — ловить 4/5 знайдених вручну помилок за секунду.
{
  const eslintBin=path.join(root,"node_modules",".bin","eslint");
  let lintOk=false,lintDetail="eslint not installed";
  if(fs.existsSync(eslintBin)){
    const lr=spawnSync(process.execPath,[eslintBin,"--no-warn-ignored","--config","tools/eslint.config.mjs",
      "app.js","crew.js","core.js","_worker.js","markdown.js","theme-boot.js","zip-safety-core.js","dtc-data.js","oauth-replay-do.js"],
      {cwd:root,encoding:"utf8",timeout:300000});
    lintOk=lr.status===0;
    const out=((lr.stdout||"")+(lr.stderr||"")).trim().split("\n").filter(l=>/error/.test(l)).slice(0,6).join(" | ");
    lintDetail=lintOk?"no-undef/no-const-assign/no-dupe-keys/no-redeclare clean":out.slice(0,400);
  }
  check("eslint gate",lintOk,lintDetail);
}

// 1c. Пропуск браузерних тестів = помилка гейту (v5.11.94, за аудитом v5.11.93):
// саме так ReferenceError скролу потрапив у реліз зі звітом «усі тести пройдено».
{
  const skipped=(sum?.results||[]).filter(x=>(x.skipped||[]).length);
  check("browser tests not skipped",!skipped.length,
    skipped.length?`SKIPPED: ${skipped.map(x=>`${x.test} (${(x.skipped||[]).length})`).join(", ")} — встанови Playwright/Chromium або виправ тести`:"всі браузерні перевірки виконано");
}

// 2. version sync
const v=JSON.parse(read("bridge-version.json")).version;
const found={
  "_worker.js VERSION":(read("_worker.js").match(/const VERSION="([^"]+)"/)||[])[1],
  "app.js UI_VERSION":(read("app.js").match(/const UI_VERSION="([^"]+)"/)||[])[1],
  "work-controller.js UI_VERSION":(read("work-controller.js").match(/const UI_VERSION="([^"]+)"/)||[])[1],
  "sw.js CACHE":((read("sw.js").match(/const CACHE="ai-bridge-v([^"]+)"/)||[])[1]||"").replaceAll("-","."),
  "manifest name":(JSON.parse(read("manifest.webmanifest")).name.match(/v(\d+\.\d+\.\d+)/)||[])[1],
  "index.html title":(read("index.html").match(/<title>AI Bridge v([\d.]+)/)||[])[1],
  "work.html title":(read("work.html").match(/Work Controller v([\d.]+)/)||[])[1],
  "index.html hero badge":(read("index.html").match(/class="heroVersion">v([\d.]+)</)||[])[1],
  "index.html sidebar":(read("index.html").match(/class="sideFoot"><a href="\/work"[^>]*>Advanced Controller<\/a><span>v([\d.]+)</)||[])[1]
};
const mism=Object.entries(found).filter(([,x])=>x!==v);
check("version sync",!mism.length,mism.length?mism.map(([k,x])=>`${k}=${x}`).join(", "):`all = ${v}`);

// 3. service worker assets exist
const assets=[...read("sw.js").matchAll(/"\.\/([^"]+)"/g)].map(m=>m[1]);
const missingAssets=assets.filter(a=>!fs.existsSync(path.join(root,a)));
check("service worker precache",!missingAssets.length,missingAssets.length?`missing: ${missingAssets.join(", ")}`:`${assets.length} assets`);

// 4. inventory vs baseline
const files=walk();
const bi=args.indexOf("--baseline");
if(bi>=0){
  const base=path.resolve(args[bi+1]||"");
  const baseFiles=fs.existsSync(base)?(function w(d){const o=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name),rel=path.relative(base,p).replaceAll(path.sep,"/");if(SKIP.test(rel))continue;if(e.isDirectory())o.push(...w(p));else o.push(rel)}return o})(base):[];
  const missing=baseFiles.filter(f=>!files.includes(f));
  check("inventory vs baseline",baseFiles.length&&!missing.length,baseFiles.length?(missing.length?`missing: ${missing.slice(0,20).join(", ")}`:`${baseFiles.length} baseline files present, ${files.length-baseFiles.length} added`):"baseline not found");
}
for(const req of ["_worker.js","index.html","app.js","styles.css","sw.js","tools/run-all-tests.mjs","bridge-version.json"])if(!files.includes(req))check(`required file ${req}`,false,"missing");

// 5. manifest
const manifest={version:v,generatedAt:new Date().toISOString(),files:Object.fromEntries(files.map(f=>{const b=fs.readFileSync(path.join(root,f));return [f,{sha256:crypto.createHash("sha256").update(b).digest("hex"),bytes:b.length}]}))};
fs.writeFileSync(path.join(root,"MANIFEST.sha256.json"),JSON.stringify(manifest,null,1)+"\n");
check("SHA-256 manifest",true,`${files.length} files -> MANIFEST.sha256.json`);

const failed=results.filter(r=>!r.ok);
if(!failed.length&&args.includes("--package")){
  fs.mkdirSync(path.join(root,"releases"),{recursive:true});
  const zip=path.join(root,"releases",`AI_Bridge_v${v}.zip`);fs.rmSync(zip,{force:true});
  const z=spawnSync("zip",["-q","-X","-r",zip,...files,"MANIFEST.sha256.json"],{cwd:root,encoding:"utf8"});
  check("package",z.status===0,z.status===0?path.relative(root,zip):String(z.stderr).slice(0,300));
}
console.log(failed.length?`\nRELEASE BLOCKED: ${failed.length} check(s) failed.`:`\nRELEASE READY: v${v}`);
process.exit(failed.length?1:0);
