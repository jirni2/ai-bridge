#!/usr/bin/env node
/* AI Bridge rollback (v5.9.1).
   Local code:   node tools/rollback.mjs <improvement-id>
     restores every file backed up by `improvement-lab.mjs --apply`.
   Production:   Cloudflare Pages keeps every deployment. Roll back in the
     dashboard (Workers & Pages -> your project -> Deployments -> "..." on the
     previous deployment -> Rollback), or redeploy the previous release ZIP
     kept in releases/ by tools/release-check.mjs --package. */
import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const id=String(process.argv[2]||"").replace(/[^A-Za-z0-9_.-]/g,"");
const dir=path.join(root,"improvements","backups",id),meta=path.join(dir,"backup.json");
if(!id||!fs.existsSync(meta)){
  const list=fs.existsSync(path.join(root,"improvements","backups"))?fs.readdirSync(path.join(root,"improvements","backups")):[];
  console.error(`Usage: node tools/rollback.mjs <id>\nAvailable backups: ${list.join(", ")||"(none)"}`);process.exit(2);
}
const {files}=JSON.parse(fs.readFileSync(meta,"utf8"));let restored=0;
for(const f of files){const src=path.join(dir,f);if(fs.existsSync(src)){fs.mkdirSync(path.dirname(path.join(root,f)),{recursive:true});fs.copyFileSync(src,path.join(root,f));restored++}}
console.log(`Restored ${restored}/${files.length} file(s) from improvement ${id}. Run node tools/run-all-tests.mjs, then redeploy.`);
