#!/usr/bin/env node
/* AI Bridge Improvement Lab validator (v5.8.0).
   The runtime Improvement Lab (/api/improvement-lab) only PROPOSES changes.
   This tool is the only path by which a proposed patch can become "validated":
     proposal -> isolated implementation -> regression tests -> full suite
     -> security tests -> comparison against baseline.
   It never modifies the project it is run from. A validated patch and its
   report are written to improvements/validated/; a rejected one to
   improvements/rejected/. Promotion into a release stays a human decision.
   Usage: node tools/improvement-lab.mjs <unified-diff.patch> [--id name] [--apply]
   v5.9.1: prints a readable diff summary for review, and with --apply (only
   after ALL gates pass) backs up every touched file to
   improvements/backups/<id>/ before patching the real project. Undo with
   node tools/rollback.mjs <id>. Deploy stays a separate human step.
   Exit code 0 = validated, 1 = rejected, 2 = usage error. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const patchFile=process.argv[2]?path.resolve(process.argv[2]):"";
if(!patchFile||!fs.existsSync(patchFile)){console.error("Usage: node tools/improvement-lab.mjs <patch-file> [--id name]");process.exit(2)}
const id=(process.argv.includes("--id")?process.argv[process.argv.indexOf("--id")+1]:path.basename(patchFile).replace(/\.[^.]+$/,"")).replace(/[^A-Za-z0-9_.-]/g,"_").slice(0,80)||"proposal";
const SECURITY_TESTS=/(security|adversarial|redirect|oauth|mcp|zip|injection|safety|super_orchestrator)/i;

function copyProject(dest){fs.cpSync(root,dest,{recursive:true,filter:src=>!/[\\/](?:\.git|node_modules|improvements)(?:[\\/]|$)/.test(path.relative(root,src)||"")})}
function suite(dir,label){
  const out=path.join(os.tmpdir(),`aib-lab-${label}-${process.pid}.json`);
  const r=spawnSync(process.execPath,["tools/run-all-tests.mjs","--json",out],{cwd:dir,encoding:"utf8",timeout:1800000,maxBuffer:128*1024*1024});
  let summary=null;try{summary=JSON.parse(fs.readFileSync(out,"utf8"))}catch(e){}
  return {exit:r.status,summary,tail:String((r.stdout||"")+(r.stderr||"")).split("\n").slice(-12).join("\n")};
}

const work=fs.mkdtempSync(path.join(os.tmpdir(),"aib-improvement-"));
const baselineDir=path.join(work,"baseline"),candidateDir=path.join(work,"candidate");
copyProject(baselineDir);copyProject(candidateDir);
const report={id,patch:path.basename(patchFile),startedAt:new Date().toISOString(),gates:{}};
// Human-readable review: which files change and by how much.
const patchText=fs.readFileSync(patchFile,"utf8"),diffFiles=[];let curFile=null;
for(const line of patchText.split("\n")){
  const m=line.match(/^\+\+\+ (?:b\/)?(\S+)/);if(m&&m[1]!=="/dev/null"){curFile={file:m[1],added:0,removed:0};diffFiles.push(curFile);continue}
  if(!curFile||line.startsWith("---"))continue;
  if(line.startsWith("+"))curFile.added++;else if(line.startsWith("-"))curFile.removed++;
}
report.diff=diffFiles;
console.log("PROPOSED CHANGES (review before applying):");
for(const f of diffFiles)console.log(`  ${f.file}  +${f.added} -${f.removed}`);

// Gate 1+2: proposal applies cleanly in an isolated copy.
const applied=spawnSync("patch",["-p1","--forward","--batch","-i",patchFile],{cwd:candidateDir,encoding:"utf8"});
report.gates.isolatedImplementation={ok:applied.status===0,detail:String(applied.stdout||applied.stderr||"").slice(0,2000)};

let baseline=null,candidate=null;
if(report.gates.isolatedImplementation.ok){
  baseline=suite(baselineDir,"baseline");
  candidate=suite(candidateDir,"candidate");
  const b=baseline.summary,c=candidate.summary;
  const failedNames=(c?.results||[]).filter(x=>!x.ok).map(x=>x.test);
  report.gates.regressionTests={ok:!!c&&!failedNames.length,failed:failedNames};
  report.gates.fullSuite={ok:candidate.exit===0,testFiles:c?.testFiles??null,pass:c?.pass??null,fail:c?.fail??null,syntaxFailures:(c?.syntaxFailures||[]).length};
  report.gates.securityTests={ok:!!c&&!(c.results||[]).some(x=>SECURITY_TESTS.test(x.test)&&!x.ok),checked:(c?.results||[]).filter(x=>SECURITY_TESTS.test(x.test)).length};
  report.gates.baselineComparison={ok:!!b&&!!c&&c.pass>=b.pass&&c.fail<=b.fail&&c.passLines>=b.passLines,baseline:b?{pass:b.pass,fail:b.fail,passLines:b.passLines}:null,candidate:c?{pass:c.pass,fail:c.fail,passLines:c.passLines}:null};
}
const validated=Object.values(report.gates).length===5&&Object.values(report.gates).every(g=>g.ok);
report.result=validated?"VALIDATED":"REJECTED";report.finishedAt=new Date().toISOString();
const outDir=path.join(root,"improvements",validated?"validated":"rejected");fs.mkdirSync(outDir,{recursive:true});
fs.copyFileSync(patchFile,path.join(outDir,`${id}.patch`));
fs.writeFileSync(path.join(outDir,`${id}.report.json`),JSON.stringify(report,null,2));
fs.rmSync(work,{recursive:true,force:true});
if(process.argv.includes("--apply")){
  if(!validated){console.error("NOT APPLIED: the patch did not pass every gate.");report.applied=false}
  else{
    const backup=path.join(root,"improvements","backups",id);fs.mkdirSync(backup,{recursive:true});
    const touched=diffFiles.map(f=>f.file).filter(f=>!f.includes(".."));
    for(const f of touched){const src=path.join(root,f);if(fs.existsSync(src)){fs.mkdirSync(path.dirname(path.join(backup,f)),{recursive:true});fs.copyFileSync(src,path.join(backup,f))}}
    fs.writeFileSync(path.join(backup,"backup.json"),JSON.stringify({id,createdAt:new Date().toISOString(),files:touched},null,2));
    const real=spawnSync("patch",["-p1","--forward","--batch","-i",patchFile],{cwd:root,encoding:"utf8"});
    report.applied=real.status===0;
    console.log(report.applied?`APPLIED. Backup: improvements/backups/${id}/  (undo: node tools/rollback.mjs ${id})`:`APPLY FAILED: ${String(real.stderr||real.stdout).slice(0,500)}`);
  }
  fs.writeFileSync(path.join(outDir,`${id}.report.json`),JSON.stringify(report,null,2));
}
console.log(JSON.stringify({id,result:report.result,applied:report.applied??false,gates:Object.fromEntries(Object.entries(report.gates).map(([k,v])=>[k,v.ok]))},null,2));
process.exit(validated?0:1);
