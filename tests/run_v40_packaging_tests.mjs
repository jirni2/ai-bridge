import fs from "node:fs";
const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
ok(/^(?:4\.\d+\.\d+|[5-9]\.\d+\.\d+)$/.test(JSON.parse(read("bridge-version.json")).version),"central version is v4.0+");
ok(/const VERSION="(?:4\.\d+\.\d+|[5-9]\.\d+\.\d+)";/.test(read("_worker.js")),"Worker version synced");
ok(/AI Bridge v(?:4\.\d+\.\d+|[5-9]\.\d+\.\d+) — Work Controller/.test(read("index.html")),"index static version synced");
ok(/Bridge Review Panel v(?:4\.\d+\.\d+|[5-9]\.\d+\.\d+)/.test(read("support.html")),"support static version synced");
ok(/v(?:4\.\d+\.\d+|[5-9]\.\d+\.\d+)/.test(JSON.parse(read("manifest.webmanifest")).name),"manifest version synced");
ok(read("work.html").includes('id="judgeEvidencePanel"'),"Judge evidence panel exists");
ok(read("work-controller.js").includes("Quote matched:"),"Quote matched has separate UI badge");
ok(read("work-controller.js").includes("Claim manually confirmed: NO"),"manual-confirmation has separate UI badge");
console.log("All v4.0 packaging tests passed.");
