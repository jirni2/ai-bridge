import fs from "node:fs";
const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
ok(/^(?:4\.[4-9]\.\d+|[5-9]\.\d+\.\d+)$/.test(JSON.parse(read("bridge-version.json")).version),"central version is v4.4+");
ok(/const VERSION="(?:4\.[4-9]\.\d+|[5-9]\.\d+\.\d+)";/.test(read("_worker.js")),"Worker version is v4.4+");
ok(/AI Bridge v(?:4\.[4-9]\.\d+|[5-9]\.\d+\.\d+) — Work Controller/.test(read("index.html")),"index version is v4.4+");
ok(/Bridge Review Panel v(?:4\.[4-9]\.\d+|[5-9]\.\d+\.\d+)/.test(read("support.html")),"support version is v4.4+");
ok(/v(?:4\.[4-9]\.\d+|[5-9]\.\d+\.\d+)/.test(JSON.parse(read("manifest.webmanifest")).name),"manifest version is v4.4+");
console.log("All v4.4 packaging tests passed.");
