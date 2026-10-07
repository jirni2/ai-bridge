import fs from "node:fs";
const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
ok(/^(?:4\.[1-9]\.\d+|[5-9]\.\d+\.\d+)$/.test(JSON.parse(read("bridge-version.json")).version),"central version is v4.1+");
ok(/const VERSION="(?:4\.[1-9]\.\d+|[5-9]\.\d+\.\d+)";/.test(read("_worker.js")),"Worker version is v4.1+");
ok(/AI Bridge v(?:4\.[1-9]\.\d+|[5-9]\.\d+\.\d+) — Work Controller/.test(read("index.html")),"index version is v4.1+");
ok(/Bridge Review Panel v(?:4\.[1-9]\.\d+|[5-9]\.\d+\.\d+)/.test(read("support.html")),"support version is v4.1+");
ok(/v(?:4\.[1-9]\.\d+|[5-9]\.\d+\.\d+)/.test(JSON.parse(read("manifest.webmanifest")).name),"manifest version is v4.1+");
ok(read("work-controller.js").includes("judgeAttempts:data.judgeAttempts"),"UI diagnostics include all Judge attempts");
console.log("All v4.1 packaging tests passed.");
