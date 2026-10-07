#!/usr/bin/env node
/* AI Bridge full-suite runner (v5.8.0).
   ROOT CAUSE this tool guards against: several historical tests used a fixed
   temporary worker filename that was identical to a fixture shipped in the
   release ZIP (tests/worker-v38-under-test.mjs, worker-v41-*.mjs,
   worker-v452-adversarial.mjs). Running the suite deleted those fixtures, so
   a package built after testing silently lost files. The tests now use unique
   temp names; this runner is the second line of defence:
     1. snapshot every project file before the suite,
     2. run EVERY tests/run_*tests.mjs sequentially with a timeout,
     3. restore any pre-existing file a test deleted or modified,
     4. remove only NEW temporary worker copies a crashed test left behind,
     5. run `node --check` on every .js/.mjs/.cjs file,
     6. exit non-zero on any failure.
   Usage: node tools/run-all-tests.mjs [--json out.json] [--only pattern] */
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const args=process.argv.slice(2);
const jsonOut=args.includes("--json")?args[args.indexOf("--json")+1]:null;
const only=args.includes("--only")?new RegExp(args[args.indexOf("--only")+1]):null;
const SKIP_DIRS=new Set([".git","node_modules"]);

function walk(dir=root){
  const out=[];
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    if(SKIP_DIRS.has(e.name))continue;
    const p=path.join(dir,e.name);
    if(e.isDirectory())out.push(...walk(p));else if(e.isFile())out.push(p);
  }
  return out;
}
function snapshot(){const m=new Map();for(const p of walk())m.set(p,fs.readFileSync(p));return m}
function restore(before){
  const restored=[],removed=[];
  for(const [p,buf] of before){
    if(!fs.existsSync(p)){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,buf);restored.push(p)}
    else{const now=fs.readFileSync(p);if(!now.equals(buf)){fs.writeFileSync(p,buf);restored.push(p)}}
  }
  for(const p of walk()){
    if(before.has(p))continue;
    const rel=path.relative(root,p).replaceAll(path.sep,"/");
    // Only temporary worker copies created by tests are cleaned up. Anything
    // else a test creates is reported, never silently deleted.
    if(/^tests\/worker-v[\w.-]+\.mjs$/.test(rel)){fs.unlinkSync(p);removed.push(rel)}
  }
  return {restored:restored.map(p=>path.relative(root,p)),removed};
}

const before=snapshot();
const tests=fs.readdirSync(path.join(root,"tests")).filter(f=>/^run_.*tests\.mjs$/.test(f)).filter(f=>!only||only.test(f)).sort();
const results=[];let pass=0,fail=0,assertions=0;
for(const t of tests){
  const started=Date.now();
  const r=spawnSync(process.execPath,[path.join("tests",t)],{cwd:root,encoding:"utf8",timeout:300000,maxBuffer:64*1024*1024});
  const out=(r.stdout||"")+(r.stderr||"");
  const ok=r.status===0;
  const n=(out.match(/^(?:PASS\b|✓|ok\b|OK\b)/gmi)||[]).length;
  assertions+=n;
  const fixed=restore(before);
  // v5.11.94: фіксуємо SKIP-маркери навіть у пройдених тестів — гейт релізу
  // вважає пропуск браузерних перевірок помилкою, а не мовчазним PASS.
  const skipLines=out.split("\n").filter(l=>/SKIP:/i.test(l)).slice(0,5);
  results.push({test:t,ok,status:r.status,signal:r.signal||null,ms:Date.now()-started,passLines:n,restored:fixed.restored,cleaned:fixed.removed.length,skipped:skipLines,tail:ok?(skipLines.length?skipLines.join("\n"):undefined):out.split("\n").slice(-25).join("\n")});
  if(ok)pass++;else{fail++;console.log(`FAIL ${t} (status ${r.status}${r.signal?`, ${r.signal}`:""})\n${out.split("\n").slice(-25).join("\n")}`)}
  if(fixed.restored.length)console.log(`  ↺ ${t}: restored ${fixed.restored.length} pre-existing file(s): ${fixed.restored.join(", ")}`);
}

// Syntax check every JavaScript file in the package.
const jsFiles=walk().filter(p=>/\.(?:js|mjs|cjs)$/.test(p));
const syntaxFailures=[];
for(const p of jsFiles){
  const r=spawnSync(process.execPath,["--check",p],{encoding:"utf8"});
  if(r.status!==0)syntaxFailures.push({file:path.relative(root,p),error:(r.stderr||"").split("\n").slice(0,6).join("\n")});
}
const finalRestore=restore(before);
const summary={testFiles:tests.length,pass,fail,passLines:assertions,syntaxChecked:jsFiles.length,syntaxFailures,finalRestored:finalRestore.restored,results};
if(jsonOut)fs.writeFileSync(jsonOut,JSON.stringify(summary,null,2));
for(const s of syntaxFailures)console.log(`SYNTAX FAIL ${s.file}\n${s.error}`);
console.log(`TEST FILES ${tests.length} • PASS ${pass} • FAIL ${fail} • PASS-LINES ${assertions} • SYNTAX ${jsFiles.length-syntaxFailures.length}/${jsFiles.length}`);
process.exit(fail||syntaxFailures.length?1:0);
